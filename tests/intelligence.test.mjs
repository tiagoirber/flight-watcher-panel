import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORTED_QUESTIONS,
  answerHistoryQuestion,
} from "../intelligence.mjs";

const NOW = Date.parse("2026-07-23T18:00:00Z");

function record(sequence, overrides = {}) {
  return {
    schema_version: 1,
    observation_id: sequence.toString(16).padStart(64, "0"),
    run_id: `run:${sequence}`,
    monitor_id: "bsb-ios",
    origin: "BSB",
    destination: "IOS",
    provider: "google_flights",
    observed_at: `2026-07-${String(sequence).padStart(2, "0")}T12:00:00Z`,
    status: "success",
    price: 1000,
    notification_required: false,
    notification_sent: false,
    ...overrides,
  };
}

function route(monitorId, origin, destination, prices, dayOffset = 0) {
  return prices.map((price, index) =>
    record(dayOffset + index + 1, {
      observation_id: `${monitorId}-${index}`.padEnd(64, "0").slice(0, 64),
      run_id: `run:${monitorId}:${index}`,
      monitor_id: monitorId,
      origin,
      destination,
      observed_at: `2026-07-${String(dayOffset + index + 1).padStart(
        2,
        "0"
      )}T12:00:00Z`,
      price,
    })
  );
}

function assertMandatoryMetadata(result) {
  assert.equal(typeof result.period.label, "string");
  assert.equal(typeof result.observations.queries, "number");
  assert.equal(typeof result.observations.prices, "number");
  assert.equal(
    result.source.dataset,
    "Histórico persistente v1 do Flight Watcher"
  );
  assert.deepEqual(result.source.providers, ["google_flights"]);
  assert.equal(result.source.externalSources, false);
  assert.ok(["baixa", "moderada", "alta"].includes(result.confidence.level));
  assert.equal(typeof result.confidence.percentage, "number");
  assert.match(result.limitations.join(" "), /não prevê preços futuros/);
}

test("answers which route fell most with traceable facts", () => {
  const records = [
    ...route("bsb-ios", "BSB", "IOS", [1000, 900, 700]),
    ...route("bsb-cgh", "BSB", "CGH", [500, 490, 480], 5),
  ];

  const result = answerHistoryQuestion(records, "Qual rota caiu mais?", {
    now: NOW,
  });

  assert.equal(result.intent, "largest_drop");
  assert.match(result.answer, /BSB → IOS/);
  assert.match(result.answer, /-22\.2%/);
  assert.equal(result.facts[1].label, "Preço anterior");
  assertMandatoryMetadata(result);
});

test("answers the cheapest current destination instead of the historical minimum", () => {
  const records = [
    ...route("bsb-ios", "BSB", "IOS", [300, 400, 450]),
    ...route("bsb-cgh", "BSB", "CGH", [900, 500, 350], 5),
  ];

  const result = answerHistoryQuestion(
    records,
    "Qual destino está mais barato?",
    { now: NOW }
  );

  assert.equal(result.intent, "cheapest_destination");
  assert.match(result.answer, /CGH/);
  assert.match(result.answer, /350/);
  assertMandatoryMetadata(result);
});

test("uses the winning route sample for cheapest-destination confidence", () => {
  const records = [
    ...route(
      "well-sampled",
      "BSB",
      "IOS",
      Array.from({ length: 20 }, () => 1000)
    ),
    record(23, {
      monitor_id: "single-price",
      destination: "CWB",
      observed_at: "2026-07-23T12:00:00Z",
      price: 100,
    }),
  ];

  const result = answerHistoryQuestion(
    records,
    "Qual destino está mais barato?",
    { now: NOW }
  );

  assert.match(result.answer, /CWB/);
  assert.equal(result.confidence.percentage, 27);
  assert.equal(result.confidence.level, "baixa");
  assert.match(result.confidence.basis, /1 preço/);
});

test("lists prices below their own route average", () => {
  const records = [
    ...route("bsb-ios", "BSB", "IOS", [1000, 900, 700]),
    ...route("bsb-cgh", "BSB", "CGH", [400, 400, 400], 5),
  ];

  const result = answerHistoryQuestion(
    records,
    "Quais preços estão abaixo da média?",
    { now: NOW }
  );

  assert.equal(result.intent, "below_average");
  assert.equal(result.facts.length, 1);
  assert.match(result.facts[0].label, /BSB → IOS/);
  assertMandatoryMetadata(result);
});

test("selects the highest eligible Flight Score", () => {
  const records = [
    ...route("bsb-ios", "BSB", "IOS", [1000, 900, 700]),
    ...route("bsb-cgh", "BSB", "CGH", [400, 500, 600], 5),
  ];

  const result = answerHistoryQuestion(
    records,
    "Qual rota apresenta o melhor Flight Score?",
    { now: NOW }
  );

  assert.equal(result.intent, "best_score");
  assert.match(result.answer, /bsb-ios/);
  assert.match(result.answer, /\/100/);
  assertMandatoryMetadata(result);
});

test("identifies routes with insufficient data", () => {
  const records = [
    record(1, { monitor_id: "only-one" }),
    ...route("enough", "BSB", "CGH", [500, 490, 480], 5),
  ];

  const result = answerHistoryQuestion(
    records,
    "Quais rotas têm dados insuficientes?",
    { now: NOW }
  );

  assert.equal(result.intent, "insufficient_data");
  assert.equal(result.facts.length, 1);
  assert.match(result.facts[0].label, /only-one/);
  assertMandatoryMetadata(result);
});

test("discloses when a multi-route answer is truncated", () => {
  const records = [];
  for (let routeIndex = 0; routeIndex < 6; routeIndex += 1) {
    records.push(
      ...route(
        `route-${routeIndex}`,
        "BSB",
        `D${routeIndex}`,
        [1000, 1000, 500],
        routeIndex * 3
      )
    );
  }

  const result = answerHistoryQuestion(
    records,
    "Quais preços estão abaixo da média?",
    { now: NOW }
  );

  assert.equal(result.intent, "below_average");
  assert.match(result.answer, /6 rota/);
  assert.equal(result.facts.length, 5);
  assert.match(result.limitations.join(" "), /Exibindo 5 de 6 resultados/);
});

test("reports only today's promotions using existing score rules", () => {
  const records = [];
  let sequence = 1;
  for (let day = 14; day <= 23; day += 1) {
    for (let sample = 0; sample < 2; sample += 1) {
      records.push(
        record(sequence, {
          observed_at: `2026-07-${day}T${sample ? "18" : "12"}:00:00Z`,
          price: day === 23 && sample === 1 ? 500 : 1000,
        })
      );
      sequence += 1;
    }
  }

  const result = answerHistoryQuestion(
    records,
    "Quais promoções apareceram hoje?",
    { period: "90", now: NOW }
  );

  assert.equal(result.intent, "promotions_today");
  assert.equal(result.period.key, "90");
  assert.match(result.period.focus, /2026-07-23/);
  assert.equal(result.observations.queries, 20);
  assert.equal(result.facts.length, 1);
  assert.match(result.answer, /1 rota/);
  assertMandatoryMetadata(result);
});

test("today follows America/Sao_Paulo rather than the UTC date", () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    record(index + 1, {
      observed_at:
        index === 19
          ? "2026-07-24T01:00:00Z"
          : new Date(
              Date.UTC(2026, 6, 14 + Math.floor(index / 2), 12)
            ).toISOString(),
      price: index === 19 ? 500 : 1000,
    })
  );
  const result = answerHistoryQuestion(records, "Promoções de hoje", {
    now: Date.parse("2026-07-24T02:00:00Z"),
  });

  assert.match(result.period.focus, /2026-07-23/);
  assert.equal(result.facts.length, 1);
});

test("refuses unsupported questions and exposes the supported set", () => {
  const records = [record(1)];
  const result = answerHistoryQuestion(
    records,
    "Quanto custará a passagem no próximo mês?",
    { now: NOW }
  );

  assert.equal(result.intent, "unsupported");
  assert.equal(result.facts.length, SUPPORTED_QUESTIONS.length);
  assert.match(result.answer, /fora do escopo|intenção suportada/);
  assert.match(result.limitations.join(" "), /nem consulta fontes externas/);
  assertMandatoryMetadata(result);
});

test("respects the selected rolling period and does not mutate records", () => {
  const records = [
    record(1, { observed_at: "2026-01-01T12:00:00Z" }),
    record(2, { observed_at: "2026-07-22T12:00:00Z" }),
  ];
  const original = structuredClone(records);

  const result = answerHistoryQuestion(
    records,
    "Qual destino está mais barato?",
    { period: "7", now: NOW }
  );

  assert.equal(result.observations.queries, 1);
  assert.deepEqual(records, original);
});

test("returns an explicit low-confidence answer for an empty sample", () => {
  const result = answerHistoryQuestion([], "Qual rota caiu mais?", {
    now: NOW,
  });

  assert.equal(result.confidence.level, "baixa");
  assert.equal(result.confidence.percentage, 0);
  assert.equal(result.source.externalSources, false);
  assert.match(result.answer, /Nenhuma rota/);
});

test("rejects unknown periods", () => {
  assert.throws(
    () =>
      answerHistoryQuestion([record(1)], "Qual rota caiu mais?", {
        period: "365",
        now: NOW,
      }),
    /período da inteligência inválido/
  );
});
