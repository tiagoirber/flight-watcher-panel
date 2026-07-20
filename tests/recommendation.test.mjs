import assert from "node:assert/strict";
import test from "node:test";

import { calculateRecommendation } from "../recommendation.mjs";

function record(index, price, overrides = {}) {
  return {
    observed_at: new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString(),
    status: price === null ? "scrape_failed" : "success",
    price,
    ...overrides,
  };
}

function recordsFor(prices) {
  return prices.map((price, index) => record(index, price));
}

function eligibleScore(overrides = {}) {
  return {
    eligible: true,
    score: 80,
    confidence: 80,
    confidenceLabel: "alta",
    ...overrides,
  };
}

test("returns insufficient when Flight Score is not eligible", () => {
  const recommendation = calculateRecommendation(recordsFor([300, 250]), {
    eligible: false,
    score: null,
    confidence: 34,
    confidenceLabel: "insuficiente",
  });

  assert.equal(recommendation.action, "insufficient");
  assert.equal(recommendation.headline, "Aguardar mais dados");
  assert.equal(recommendation.dataUsed.prices, 2);
  assert.equal(recommendation.dataUsed.distinctDays, 2);
});

test("suggests considering a purchase only when all conditions pass", () => {
  const recommendation = calculateRecommendation(
    recordsFor([500, 480, 460, 440, 420, 400, 380, 360, 340, 320, 300, 250]),
    eligibleScore()
  );

  assert.equal(recommendation.action, "buy");
  assert.equal(recommendation.headline, "Vale considerar comprar agora");
  assert.deepEqual(recommendation.conditions, {
    score: true,
    confidence: true,
    belowAverage: true,
  });
});

test("suggests waiting when score is below the threshold", () => {
  const recommendation = calculateRecommendation(
    recordsFor([500, 400, 300]),
    eligibleScore({ score: 74 })
  );

  assert.equal(recommendation.action, "wait");
  assert.equal(recommendation.conditions.score, false);
  assert.match(recommendation.reasons.join(" "), /pelo menos 75/);
});

test("suggests waiting when confidence is below the threshold", () => {
  const recommendation = calculateRecommendation(
    recordsFor([500, 400, 300]),
    eligibleScore({ confidence: 69, confidenceLabel: "moderada" })
  );

  assert.equal(recommendation.action, "wait");
  assert.equal(recommendation.conditions.confidence, false);
  assert.match(recommendation.reasons.join(" "), /pelo menos 70%/);
});

test("suggests waiting when current price is not below average", () => {
  const recommendation = calculateRecommendation(
    recordsFor([100, 120, 200]),
    eligibleScore()
  );

  assert.equal(recommendation.action, "wait");
  assert.equal(recommendation.conditions.belowAverage, false);
  assert.equal(recommendation.signals.belowAverage.state, "above");
});

test("classifies a sufficiently sampled near-minimum price as rare", () => {
  const recommendation = calculateRecommendation(
    recordsFor([220, 210, 200, 190, 180, 170, 160, 150, 140, 100]),
    eligibleScore()
  );

  assert.equal(recommendation.signals.rarity.eligible, true);
  assert.equal(recommendation.signals.rarity.rare, true);
  assert.match(recommendation.signals.rarity.label, /Preço raro/);
});

test("does not claim rarity with fewer than ten prices", () => {
  const recommendation = calculateRecommendation(
    recordsFor([220, 200, 180, 160, 140, 120, 100]),
    eligibleScore()
  );

  assert.equal(recommendation.signals.rarity.eligible, false);
  assert.equal(recommendation.signals.rarity.rare, false);
  assert.match(recommendation.signals.rarity.label, /exige 10 preços/);
});

test("describes falling, rising and stable recent trends", () => {
  const falling = calculateRecommendation(
    recordsFor([500, 450, 400]),
    eligibleScore()
  );
  const rising = calculateRecommendation(
    recordsFor([400, 450, 500]),
    eligibleScore()
  );
  const stable = calculateRecommendation(
    recordsFor([500, 505, 504]),
    eligibleScore()
  );

  assert.equal(falling.signals.trend.direction, "falling");
  assert.equal(rising.signals.trend.direction, "rising");
  assert.equal(stable.signals.trend.direction, "stable");
});

test("counts failed queries as data but never as prices", () => {
  const records = [
    ...recordsFor([500, 400, 300]),
    record(5, null),
    record(6, null),
  ];
  const recommendation = calculateRecommendation(records, eligibleScore());

  assert.equal(recommendation.dataUsed.queries, 5);
  assert.equal(recommendation.dataUsed.prices, 3);
});

test("is deterministic and avoids predictive promises", () => {
  const records = recordsFor([500, 450, 400, 350]);
  const first = calculateRecommendation(records, eligibleScore());
  const second = calculateRecommendation([...records].reverse(), eligibleScore());

  assert.deepEqual(first, second);
  assert.doesNotMatch(`${first.headline} ${first.summary}`, /vai|garant|certeza/i);
  assert.match(first.disclaimer, /não prevê preços futuros/);
});
