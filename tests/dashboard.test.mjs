import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboard,
  calculateNextExecution,
  filterDashboardRecords,
  parseScheduleInterval,
} from "../dashboard.mjs";

function observation(index, overrides = {}) {
  const price = overrides.price === undefined ? 500 - index * 10 : overrides.price;
  return {
    run_id: overrides.run_id ?? "github:1:1",
    monitor_id: overrides.monitor_id ?? "bsb-cgh",
    origin: overrides.origin ?? "BSB",
    destination: overrides.destination ?? "CGH",
    observed_at:
      overrides.observed_at ??
      new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString(),
    status: overrides.status ?? (price === null ? "scrape_failed" : "success"),
    error_code: overrides.error_code ?? (price === null ? "price-not-found" : null),
    price,
    carrier: overrides.carrier ?? null,
    notification_required: overrides.notification_required ?? false,
    notification_sent: overrides.notification_sent ?? false,
  };
}

function routePrices(monitorId, prices, overrides = {}) {
  return prices.map((price, index) =>
    observation(index, {
      monitor_id: monitorId,
      price,
      run_id: `github:${index + 1}:1`,
      ...overrides,
    })
  );
}

test("parses only the supported fixed-minute GitHub Actions cron", () => {
  assert.equal(
    parseScheduleInterval('on:\n  schedule:\n    - cron: "*/30 * * * *"\n'),
    30
  );
  assert.equal(parseScheduleInterval("    - cron: '*/15 * * * *'"), 15);
  assert.equal(parseScheduleInterval('    - cron: "*/17 * * * *"'), null);
  assert.equal(parseScheduleInterval('    - cron: "0 * * * *"'), null);
  assert.equal(parseScheduleInterval(null), null);
});

test("calculates the next strict cron boundary", () => {
  assert.equal(
    calculateNextExecution(Date.parse("2026-07-20T12:01:00Z"), 30),
    "2026-07-20T12:30:00.000Z"
  );
  assert.equal(
    calculateNextExecution(Date.parse("2026-07-20T12:30:00Z"), 30),
    "2026-07-20T13:00:00.000Z"
  );
  assert.equal(calculateNextExecution(Date.now(), null), null);
});

test("filters the global dashboard by rolling period", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");
  const records = [
    observation(1, { observed_at: "2026-07-01T12:00:00Z" }),
    observation(2, { observed_at: "2026-07-18T12:00:00Z" }),
  ];

  assert.equal(filterDashboardRecords(records, "7", now).length, 1);
  assert.equal(filterDashboardRecords(records, "30", now).length, 2);
  assert.throws(() => filterDashboardRecords(records, "365", now), /inválido/);
});

test("ranks buy recommendations before wait and insufficient samples", () => {
  const falling = routePrices(
    "falling",
    [500,490,480,470,460,450,440,430,420,410,400,390,380,370,360,350,340,330,320,300]
  );
  const rising = routePrices(
    "rising",
    [300,310,320,330,340,350,360,370,380,390,400,410,420,430,440,450,460,470,480,490]
  );
  const short = routePrices("short", [300]);
  const result = buildDashboard([...short, ...rising, ...falling], {
    now: Date.parse("2026-07-25T12:00:00Z"),
  });

  assert.deepEqual(
    result.promotionRanking.map((item) => [item.monitorId, item.action]),
    [
      ["falling", "buy"],
      ["rising", "wait"],
      ["short", "insufficient"],
    ]
  );
  assert.deepEqual(result.promotionRanking.map((item) => item.rank), [1, 2, 3]);
});

test("calculates lowest prices and latest route movements", () => {
  const result = buildDashboard([
    ...routePrices("drop", [500, 450, 360]),
    ...routePrices("rise", [200, 220, 275]),
    ...routePrices("flat", [100, 100]),
  ]);

  assert.equal(result.lowestPrices[0].monitorId, "flat");
  assert.equal(result.lowestPrices[0].minimum, 100);
  assert.equal(result.largestDrops[0].monitorId, "drop");
  assert.equal(result.largestDrops[0].movementPercent, -20);
  assert.equal(result.largestRises[0].monitorId, "rise");
  assert.equal(result.largestRises[0].movementPercent, 25);
});

test("aggregates averages by destination, carrier and observation month", () => {
  const result = buildDashboard([
    observation(1, { price: 100, destination: "CGH", carrier: "Azul", observed_at: "2026-06-10T12:00:00Z" }),
    observation(2, { price: 300, destination: "CGH", carrier: "Azul", observed_at: "2026-06-11T12:00:00Z" }),
    observation(3, { price: 250, destination: "CWB", carrier: "LATAM", observed_at: "2026-07-10T12:00:00Z" }),
    observation(4, { price: null, status: "scrape_failed", error_code: "blocked", destination: "CWB", observed_at: "2026-07-11T12:00:00Z" }),
  ]);

  assert.deepEqual(result.destinationAverages, [
    { destination: "CGH", prices: 2, mean: 200, minimum: 100 },
    { destination: "CWB", prices: 1, mean: 250, minimum: 250 },
  ]);
  assert.deepEqual(result.carrierAverages, [
    { carrier: "Azul", prices: 2, mean: 200, minimum: 100 },
    { carrier: "LATAM", prices: 1, mean: 250, minimum: 250 },
  ]);
  assert.deepEqual(result.monthlyAverages.map((item) => item.month), ["2026-07", "2026-06"]);
});

test("keeps company averages empty when the source has no carrier", () => {
  const result = buildDashboard(routePrices("route", [300, 250, 200]));
  assert.deepEqual(result.carrierAverages, []);
});

test("lists alerts, failures, error codes and most monitored routes", () => {
  const records = [
    observation(1, { monitor_id: "busy", notification_required: true, notification_sent: true }),
    observation(2, { monitor_id: "busy" }),
    observation(3, { monitor_id: "busy", price: null, status: "scrape_failed", error_code: "blocked" }),
    observation(4, { monitor_id: "quiet", price: 400, notification_required: true, notification_sent: false, status: "notification_failed", error_code: "telegram-failed" }),
  ];
  const result = buildDashboard(records);

  assert.equal(result.alerts.length, 2);
  assert.deepEqual(result.alerts.map((item) => item.outcome), ["failed", "sent"]);
  assert.equal(result.failedQueries.length, 2);
  assert.deepEqual(result.failureCodes, [
    { errorCode: "blocked", queries: 1 },
    { errorCode: "telegram-failed", queries: 1 },
  ]);
  assert.equal(result.monitoredRoutes[0].monitorId, "busy");
  assert.equal(result.monitoredRoutes[0].queries, 3);
});

test("classifies a recent successful run as healthy", () => {
  const now = Date.parse("2026-07-20T12:30:00Z");
  const records = [
    observation(1, { run_id: "github:2:1", observed_at: "2026-07-20T12:10:00Z" }),
    observation(2, { run_id: "github:2:1", observed_at: "2026-07-20T12:12:00Z" }),
  ];
  const result = buildDashboard(records, { now, intervalMinutes: 30 });

  assert.equal(result.system.health.level, "healthy");
  assert.equal(result.system.lastExecution.queries, 2);
  assert.equal(result.system.nextExecution, "2026-07-20T13:00:00.000Z");
});

test("classifies partial failure as attention and stale data as critical", () => {
  const recent = [
    observation(1, { run_id: "github:2:1", observed_at: "2026-07-20T12:10:00Z" }),
    observation(2, { run_id: "github:2:1", observed_at: "2026-07-20T12:12:00Z", price: null, status: "scrape_failed", error_code: "blocked" }),
  ];
  assert.equal(
    buildDashboard(recent, {
      now: Date.parse("2026-07-20T12:30:00Z"),
      intervalMinutes: 30,
    }).system.health.level,
    "attention"
  );
  assert.equal(
    buildDashboard(recent, {
      now: Date.parse("2026-07-20T15:30:00Z"),
      intervalMinutes: 30,
    }).system.health.level,
    "critical"
  );
});

test("excludes imported migration records from operational health", () => {
  const imported = observation(1, {
    run_id: "migration:state-v1",
    status: "imported",
  });
  const result = buildDashboard([imported], {
    now: Date.parse("2026-07-20T12:30:00Z"),
    intervalMinutes: 30,
  });

  assert.equal(result.sample.prices, 1);
  assert.equal(result.system.health.level, "unknown");
  assert.equal(result.system.lastExecution, null);
});

test("returns explicit empty collections for an empty period", () => {
  const result = buildDashboard([], {
    now: Date.parse("2026-07-20T12:30:00Z"),
    intervalMinutes: 30,
  });

  assert.deepEqual(result.sample, { queries: 0, prices: 0, monitors: 0 });
  assert.deepEqual(result.promotionRanking, []);
  assert.deepEqual(result.lowestPrices, []);
  assert.deepEqual(result.destinationAverages, []);
  assert.deepEqual(result.monitoredRoutes, []);
  assert.equal(result.system.health.level, "unknown");
});

test("is deterministic and does not mutate its input", () => {
  const records = [...routePrices("a", [300, 250, 200]), ...routePrices("b", [200, 250, 300])];
  const snapshot = structuredClone(records);
  const options = { now: Date.parse("2026-07-20T12:30:00Z"), intervalMinutes: 30 };

  assert.deepEqual(buildDashboard(records, options), buildDashboard([...records].reverse(), options));
  assert.deepEqual(records, snapshot);
});
