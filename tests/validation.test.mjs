import assert from "node:assert/strict";
import test from "node:test";

import {
  ValidationError,
  looksLikeGitHubToken,
  normalizeIata,
  validateAlertBelow,
  validateCityName,
  validateFlightId,
  validateFlightInput,
  validateIsoDate,
} from "../validation.mjs";

const validFlight = {
  id: "bsb-ios-jan27",
  origin: "BSB",
  destination: "IOS",
  origin_name: "Brasília",
  destination_name: "Ilhéus",
  departure: "2027-01-19",
  return_date: "2027-01-26",
  alert_below: "1200",
};

test("recognizes supported GitHub token formats", () => {
  assert.equal(looksLikeGitHubToken(`github_pat_${"a".repeat(30)}`), true);
  assert.equal(looksLikeGitHubToken(`ghp_${"a".repeat(30)}`), true);
  assert.equal(looksLikeGitHubToken("poker2026"), false);
  assert.equal(looksLikeGitHubToken(""), false);
});

test("normalizes a valid flight without changing its schema", () => {
  assert.deepEqual(validateFlightInput({ ...validFlight, origin: "bsb" }), {
    action: "add",
    ...validFlight,
  });
});

test("accepts legitimate city names", () => {
  assert.equal(validateCityName("  São João d'Oeste  ", "Cidade"), "São João d'Oeste");
});

test("rejects unsafe flight ids", () => {
  for (const value of [
    "Bad",
    "bad id",
    "bad_id",
    "bad/id",
    "bad$(whoami)",
    "bad`whoami`",
    "-leading",
    "trailing-",
    "a".repeat(65),
    "bad\nline",
  ]) {
    assert.throws(() => validateFlightId(value), ValidationError, value);
  }
});

test("normalizes and validates IATA codes", () => {
  assert.equal(normalizeIata(" bsb ", "Origem"), "BSB");
  for (const value of ["BS", "BSB1", "B$B", "12A", ""]) {
    assert.throws(() => normalizeIata(value, "Origem"), ValidationError, value);
  }
});

test("validates real ISO dates", () => {
  assert.equal(validateIsoDate("2028-02-29", "Data"), "2028-02-29");
  for (const value of ["2027-02-29", "2027-02-30", "2027-2-01", "not-a-date"] ) {
    assert.throws(() => validateIsoDate(value, "Data"), ValidationError, value);
  }
});

test("requires return after departure", () => {
  assert.throws(
    () => validateFlightInput({ ...validFlight, return_date: validFlight.departure }),
    ValidationError
  );
  assert.throws(
    () => validateFlightInput({ ...validFlight, return_date: "2027-01-18" }),
    ValidationError
  );
});

test("rejects non-finite and non-positive alert values", () => {
  assert.equal(validateAlertBelow(""), "");
  assert.equal(validateAlertBelow("1200.50"), "1200.50");
  for (const value of ["0", "-1", "NaN", "Infinity", "1e10000", "0x10", "abc"]) {
    assert.throws(() => validateAlertBelow(value), ValidationError, value);
  }
});

test("rejects control characters and oversized city names", () => {
  for (const value of ["Brasília\nFederal", "Cidade\tInválida", "Cidade\u200B", "a".repeat(101)]) {
    assert.throws(() => validateCityName(value, "Cidade"), ValidationError, value);
  }
});
