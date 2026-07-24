const FLIGHT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const IATA_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CONTROL_CHARACTER_RE = /\p{C}/u;
const MAX_CITY_NAME_LENGTH = 100;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateFlightId(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!FLIGHT_ID_RE.test(value)) {
    throw new ValidationError(
      "O ID deve ter de 1 a 64 caracteres e usar apenas letras minúsculas, " +
      "números e hífens, sem hífen no início ou no fim."
    );
  }
  return value;
}

export function normalizeIata(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim().toUpperCase();
  if (!IATA_RE.test(value)) {
    throw new ValidationError(`${fieldName} deve ser um código IATA de três letras.`);
  }
  return value;
}

export function validateCityName(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    throw new ValidationError(`${fieldName} não pode ser vazio.`);
  }
  if (value.length > MAX_CITY_NAME_LENGTH) {
    throw new ValidationError(
      `${fieldName} deve ter no máximo ${MAX_CITY_NAME_LENGTH} caracteres.`
    );
  }
  if (CONTROL_CHARACTER_RE.test(value)) {
    throw new ValidationError(`${fieldName} contém caracteres de controle inválidos.`);
  }
  return value;
}

export function validateIsoDate(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    throw new ValidationError(`${fieldName} deve ser uma data válida no formato AAAA-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  if (
    year < 1 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError(`${fieldName} deve ser uma data válida no formato AAAA-MM-DD.`);
  }
  return value;
}

export function validateAlertBelow(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return "";

  const numericValue = Number(value);
  if (!DECIMAL_RE.test(value) || !Number.isFinite(numericValue) || numericValue <= 0) {
    throw new ValidationError("O limite de preço deve ser um número finito e maior que zero.");
  }
  return value;
}

export function validateFlightInput(rawInput) {
  const departure = validateIsoDate(rawInput.departure, "A data de ida");
  const returnDate = validateIsoDate(rawInput.return_date, "A data de volta");
  if (returnDate <= departure) {
    throw new ValidationError("A data de volta deve ser posterior à data de ida.");
  }

  return {
    action: "add",
    id: validateFlightId(rawInput.id),
    origin: normalizeIata(rawInput.origin, "A origem"),
    destination: normalizeIata(rawInput.destination, "O destino"),
    origin_name: validateCityName(rawInput.origin_name, "A cidade de origem"),
    destination_name: validateCityName(
      rawInput.destination_name,
      "A cidade de destino"
    ),
    departure,
    return_date: returnDate,
    alert_below: validateAlertBelow(rawInput.alert_below),
  };
}
