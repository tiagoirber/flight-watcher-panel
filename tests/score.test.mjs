import assert from "node:assert/strict";
import test from "node:test";

import { calculateFlightScore, classifyScore } from "../score.mjs";

function record(index, price, overrides = {}) {
  const observedAt = new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString();
  return {
    observed_at: observedAt,
    status: price === null ? "scrape_failed" : "success",
    price,
    ...overrides,
  };
}

function recordsFor(prices) {
  return prices.map((price, index) => record(index, price));
}

test("classifies every documented score boundary", () => {
  assert.equal(classifyScore(100).label, "excelente");
  assert.equal(classifyScore(90).label, "excelente");
  assert.equal(classifyScore(89).label, "muito bom");
  assert.equal(classifyScore(75).label, "muito bom");
  assert.equal(classifyScore(74).label, "bom");
  assert.equal(classifyScore(60).label, "bom");
  assert.equal(classifyScore(59).label, "fraco");
  assert.equal(classifyScore(40).label, "fraco");
  assert.equal(classifyScore(39).label, "evitar");
  assert.equal(classifyScore(0).label, "evitar");
  assert.equal(classifyScore(null).label, "dados insuficientes");
});

test("does not score fewer than three real prices", () => {
  const result = calculateFlightScore(recordsFor([300, 250]));

  assert.equal(result.eligible, false);
  assert.equal(result.score, null);
  assert.equal(result.classification, "dados insuficientes");
  assert.equal(result.sample.prices, 2);
  assert.match(result.justifications[0], /Amostra insuficiente/);
});

test("does not score prices concentrated in a single day", () => {
  const sameDay = recordsFor([300, 250, 200]).map((item, index) => ({
    ...item,
    observed_at: `2026-07-01T${String(10 + index).padStart(2, "0")}:00:00Z`,
  }));
  const result = calculateFlightScore(sameDay);

  assert.equal(result.eligible, false);
  assert.equal(result.sample.distinctDays, 1);
});

test("produces a bounded deterministic score for an eligible sample", () => {
  const sample = recordsFor([300, 280, 260, 240]);
  const first = calculateFlightScore(sample);
  const second = calculateFlightScore([...sample].reverse());

  assert.equal(first.eligible, true);
  assert.equal(first.score, second.score);
  assert.ok(first.score >= 0 && first.score <= 100);
  assert.ok(first.rawScore >= 0 && first.rawScore <= 100);
  for (const component of Object.values(first.components)) {
    assert.ok(component >= 0 && component <= 100);
  }
});

test("scores a falling price more favorably than a rising price", () => {
  const falling = calculateFlightScore(recordsFor([500, 450, 400, 350, 300, 250, 200]));
  const rising = calculateFlightScore(recordsFor([200, 250, 300, 350, 400, 450, 500]));

  assert.ok(falling.score > rising.score);
  assert.ok(falling.components.recentTrend > rising.components.recentTrend);
  assert.ok(
    falling.components.historicalPosition > rising.components.historicalPosition
  );
});

test("handles a constant-price sample without NaN or artificial trend", () => {
  const result = calculateFlightScore(recordsFor([200, 200, 200, 200]));

  assert.equal(result.eligible, true);
  assert.equal(result.components.historicalPosition, 50);
  assert.equal(result.components.recentTrend, 50);
  assert.equal(result.components.volatility, 100);
  assert.ok(Number.isFinite(result.score));
  assert.match(result.justifications.join(" "), /estáveis/);
});

test("shrinks a low-confidence raw score toward neutral", () => {
  const result = calculateFlightScore(recordsFor([400, 250, 100]));

  assert.ok(result.confidence < 100);
  assert.ok(Math.abs(result.score - 50) < Math.abs(result.rawScore - 50));
});

test("failed queries lower confidence without becoming prices", () => {
  const priced = recordsFor([500, 450, 400, 350, 300, 250, 200]);
  const failures = Array.from({ length: 7 }, (_, index) =>
    record(10 + index, null)
  );
  const complete = calculateFlightScore(priced);
  const partial = calculateFlightScore([...priced, ...failures]);

  assert.equal(partial.sample.prices, complete.sample.prices);
  assert.equal(partial.rawScore, complete.rawScore);
  assert.ok(partial.confidence < complete.confidence);
  assert.ok(Math.abs(partial.score - 50) < Math.abs(complete.score - 50));
});

test("returns transparent non-predictive justifications", () => {
  const result = calculateFlightScore(recordsFor([500, 450, 400, 350]));
  const explanation = result.justifications.join(" ");

  assert.ok(result.justifications.length >= 6);
  assert.match(explanation, /média/);
  assert.match(explanation, /mediana/);
  assert.match(explanation, /Volatilidade/);
  assert.match(explanation, /Confiança/);
  assert.doesNotMatch(explanation, /garant|previs|certeza/i);
});
