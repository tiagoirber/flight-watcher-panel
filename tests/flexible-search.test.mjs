import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AUTHORIZED_COMBINATIONS,
  calculateAuthorizedCombinations,
  validateFlexibleInput,
} from "../flexible-search.mjs";

function flexibleInput(overrides = {}) {
  return {
    id: "ferias-flexiveis",
    origins: "bsb",
    destinations: "gru, cgh",
    region_name: "",
    region_airports: "",
    alternative_origins: "",
    alternative_destinations: "",
    departure_start: "2027-01-19",
    departure_end: "2027-01-19",
    min_stay_days: "7",
    max_stay_days: "7",
    budget: "1200",
    max_stops: "1",
    priority: "60",
    enabled: true,
    notifications_enabled: true,
    ...overrides,
  };
}

test("calculates and serializes an explicit flexible authorization", () => {
  const input = flexibleInput();
  const preview = calculateAuthorizedCombinations(input);

  assert.equal(preview.count, 2);
  assert.deepEqual(preview.spec.origins, ["BSB"]);
  assert.deepEqual(preview.spec.destinations, ["GRU", "CGH"]);

  const workflowInput = validateFlexibleInput({
    ...input,
    confirmed_combinations: preview.count,
  });
  assert.equal(workflowInput.action, "add");
  assert.equal(workflowInput.mode, "flexible");
  assert.equal(workflowInput.id, "ferias-flexiveis");
  assert.deepEqual(JSON.parse(workflowInput.flexible_spec), preview.spec);
});

test("combines explicit regions and alternative airports without duplicates", () => {
  const preview = calculateAuthorizedCombinations(
    flexibleInput({
      destinations: "",
      region_name: "Sudeste",
      region_airports: "gru, cgh",
      alternative_origins: "BSB, GYN",
      alternative_destinations: "VCP, gru",
    })
  );

  assert.equal(preview.count, 6);
  assert.deepEqual(preview.spec.region, {
    name: "Sudeste",
    airports: ["GRU", "CGH"],
  });
});

test("requires a destination or a complete explicit region", () => {
  assert.throws(
    () => calculateAuthorizedCombinations(flexibleInput({ destinations: "" })),
    /destino ou uma região/
  );
  assert.throws(
    () =>
      calculateAuthorizedCombinations(
        flexibleInput({
          destinations: "",
          region_name: "Sul",
          region_airports: "",
        })
      ),
    /nome e ao menos um aeroporto/
  );
});

test("enforces departure, stay, airport and expansion bounds", () => {
  assert.throws(
    () =>
      calculateAuthorizedCombinations(
        flexibleInput({
          departure_start: "2027-01-01",
          departure_end: "2027-02-01",
        })
      ),
    /no máximo 31 dias/
  );
  assert.throws(
    () =>
      calculateAuthorizedCombinations(
        flexibleInput({ min_stay_days: "8", max_stay_days: "7" })
      ),
    /máxima deve ser/
  );
  assert.throws(
    () =>
      calculateAuthorizedCombinations(
        flexibleInput({ destinations: "GRU, INVALID" })
      ),
    /IATA inválido/
  );
  assert.throws(
    () =>
      calculateAuthorizedCombinations(
        flexibleInput({
          origins: "BSB,GYN",
          destinations: "GRU,CGH",
          departure_start: "2027-01-01",
          departure_end: "2027-01-17",
        })
      ),
    new RegExp(`limite é ${MAX_AUTHORIZED_COMBINATIONS}`)
  );
});

test("fails when confirmation is absent or stale", () => {
  const input = flexibleInput();
  assert.throws(
    () => validateFlexibleInput({ ...input, confirmed_combinations: null }),
    /confirme novamente/
  );
  assert.throws(
    () => validateFlexibleInput({ ...input, confirmed_combinations: 1 }),
    /confirme novamente/
  );
});

test("validates budget, stops and priority", () => {
  for (const candidate of [
    { budget: "NaN" },
    { budget: "0" },
    { max_stops: "3" },
    { priority: "0" },
  ]) {
    assert.throws(() =>
      calculateAuthorizedCombinations(flexibleInput(candidate))
    );
  }
});
