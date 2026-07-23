import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryDataError,
  calculateStatistics,
  chartSeries,
  compareCarriers,
  filterHistory,
  mergeHistorySegments,
  parseHistorySegment,
  safeResultUrl,
  validateManifest,
} from "../history.mjs";

function observation(sequence, overrides = {}) {
  return {
    schema_version: 1,
    observation_id: sequence.toString(16).padStart(64, "0"),
    monitor_id: "bsb-cgh",
    observed_at: `2026-07-${String(sequence).padStart(2, "0")}T12:00:00+00:00`,
    status: "success",
    price: 100 * sequence,
    carrier: null,
    result_url: null,
    query_duration_ms: 1000,
    ...overrides,
  };
}

function partition(overrides = {}) {
  return {
    path: "2026/07/19-001.jsonl",
    date: "2026-07-19",
    records: 1,
    bytes: 500,
    ...overrides,
  };
}

test("validates a safe v1 manifest", () => {
  const manifest = validateManifest({
    schema_version: 1,
    updated_at: "2026-07-19T12:00:00+00:00",
    partitions: [partition()],
  });

  assert.equal(manifest.partitions.length, 1);
  assert.equal(manifest.partitions[0].path, "2026/07/19-001.jsonl");
});

test("rejects unsafe or oversized manifest partitions", () => {
  for (const candidate of [
    partition({ path: "../state.json" }),
    partition({ bytes: 1024 * 1024 + 1 }),
    partition({ records: -1 }),
  ]) {
    assert.throws(
      () =>
        validateManifest({
          schema_version: 1,
          partitions: [candidate],
        }),
      HistoryDataError
    );
  }
});

test("parses JSONL and enforces manifest record counts", () => {
  const record = observation(1);
  const content = `${JSON.stringify(record)}\n`;
  assert.deepEqual(
    parseHistorySegment(
      content,
      partition({ bytes: Buffer.byteLength(content, "utf8") })
    ),
    [record]
  );
  assert.throws(
    () => parseHistorySegment("", partition({ bytes: 0 })),
    /Contagem da partição/
  );
  assert.throws(
    () =>
      parseHistorySegment(
        "not-json\n",
        partition({ bytes: Buffer.byteLength("not-json\n", "utf8") })
      ),
    /JSON inválido/
  );
  assert.throws(
    () => parseHistorySegment(content, partition({ bytes: 1 })),
    /Tamanho da partição/
  );
});

test("accepts valid optional flexible metadata and rejects malformed metadata", () => {
  const flexible = observation(1, {
    search_group_id: "ferias-flexiveis",
    search_mode: "flexible",
    budget: 1200,
    max_stops: 1,
    is_alternative_origin: false,
    is_alternative_destination: true,
  });
  const content = `${JSON.stringify(flexible)}\n`;
  assert.equal(
    parseHistorySegment(
      content,
      partition({ bytes: Buffer.byteLength(content, "utf8") })
    )[0].search_group_id,
    "ferias-flexiveis"
  );

  for (const invalid of [
    { ...observation(2), search_group_id: "orphan-group" },
    { ...flexible, search_group_id: "" },
    { ...flexible, budget: -1 },
    { ...flexible, max_stops: 3 },
    { ...flexible, is_alternative_origin: "false" },
  ]) {
    const invalidContent = `${JSON.stringify(invalid)}\n`;
    assert.throws(
      () =>
        parseHistorySegment(
          invalidContent,
          partition({ bytes: Buffer.byteLength(invalidContent, "utf8") })
        ),
      HistoryDataError
    );
  }
});

test("rejects duplicate observations across segments", () => {
  const record = observation(1);
  assert.throws(() => mergeHistorySegments([[record], [record]]), /duplicada/);
});

test("filters by monitor and rolling period", () => {
  const records = [
    observation(1, { observed_at: "2026-07-01T12:00:00Z" }),
    observation(2, { observed_at: "2026-07-18T12:00:00Z" }),
    observation(3, {
      monitor_id: "other-monitor",
      observed_at: "2026-07-19T12:00:00Z",
    }),
  ];
  const now = Date.parse("2026-07-19T12:00:00Z");

  assert.deepEqual(
    filterHistory(records, "bsb-cgh", "7", now).map((record) => record.price),
    [200]
  );
  assert.equal(filterHistory(records, "bsb-cgh", "all", now).length, 2);
  assert.throws(() => filterHistory(records, "bsb-cgh", "365", now));
});

test("calculates price statistics with an even sample", () => {
  const statistics = calculateStatistics([
    observation(1, { price: 100 }),
    observation(2, { price: 200 }),
    observation(3, { price: 300 }),
    observation(4, { price: 400 }),
    observation(5, { status: "scrape_failed", price: null }),
  ]);

  assert.equal(statistics.observations, 5);
  assert.equal(statistics.prices, 4);
  assert.equal(statistics.current, 400);
  assert.equal(statistics.minimum, 100);
  assert.equal(statistics.maximum, 400);
  assert.equal(statistics.mean, 250);
  assert.equal(statistics.median, 250);
  assert.equal(statistics.variation, 300);
  assert.equal(statistics.variationPercent, 300);
  assert.ok(Math.abs(statistics.volatility - 111.80339887498948) < 0.0001);
});

test("returns empty metrics when the period has no prices", () => {
  const statistics = calculateStatistics([
    observation(1, { status: "scrape_failed", price: null }),
  ]);

  assert.equal(statistics.observations, 1);
  assert.equal(statistics.prices, 0);
  assert.equal(statistics.mean, null);
  assert.equal(statistics.volatility, null);
});

test("compares only records that contain real carrier and price data", () => {
  const comparison = compareCarriers([
    observation(1, { carrier: "Azul", price: 300 }),
    observation(2, { carrier: "Azul", price: 100 }),
    observation(3, { carrier: "LATAM", price: 250 }),
    observation(4, { carrier: null, price: 50 }),
  ]);

  assert.deepEqual(comparison, [
    { carrier: "Azul", observations: 2, minimum: 100, mean: 200 },
    { carrier: "LATAM", observations: 1, minimum: 250, mean: 250 },
  ]);
});

test("builds chart series only from priced records", () => {
  const series = chartSeries([
    observation(1, { price: 100 }),
    observation(2, { price: null, status: "scrape_failed" }),
  ]);

  assert.deepEqual(series, [
    { observedAt: "2026-07-01T12:00:00+00:00", price: 100 },
  ]);
});

test("allows only HTTPS Google result links", () => {
  assert.match(
    safeResultUrl("https://www.google.com/travel/flights?tfs=safe"),
    /^https:\/\/www\.google\.com\//
  );
  for (const url of [
    "javascript:alert(1)",
    "http://www.google.com/travel/flights",
    "https://google.com.evil.test/",
    "https://example.test/",
  ]) {
    assert.equal(safeResultUrl(url), null, url);
  }
});
