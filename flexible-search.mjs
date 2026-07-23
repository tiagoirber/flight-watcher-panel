import {
  ValidationError,
  validateFlightId,
  validateIsoDate,
} from "./validation.mjs";

export const MAX_AUTHORIZED_COMBINATIONS = 64;
export const MAX_AIRPORTS_PER_FIELD = 10;
export const MAX_DEPARTURE_WINDOW_DAYS = 31;
export const MAX_STAY_DAYS = 30;

const IATA_RE = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_RE = /\p{C}/u;

function parseIataList(rawValue, fieldName, { required = false } = {}) {
  const values = [
    ...new Set(
      String(rawValue ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
  if (required && values.length === 0) {
    throw new ValidationError(`${fieldName} deve informar ao menos um aeroporto.`);
  }
  if (values.length > MAX_AIRPORTS_PER_FIELD) {
    throw new ValidationError(
      `${fieldName} aceita no máximo ${MAX_AIRPORTS_PER_FIELD} aeroportos.`
    );
  }
  const invalid = values.find((value) => !IATA_RE.test(value));
  if (invalid) {
    throw new ValidationError(
      `${fieldName} contém um código IATA inválido: ${invalid}.`
    );
  }
  return values;
}

function parseInteger(rawValue, fieldName, minimum, maximum) {
  const text = String(rawValue ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new ValidationError(`${fieldName} deve ser um número inteiro.`);
  }
  const value = Number(text);
  if (value < minimum || value > maximum) {
    throw new ValidationError(
      `${fieldName} deve estar entre ${minimum} e ${maximum}.`
    );
  }
  return value;
}

function parseOptionalBudget(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(
      "O orçamento deve ser um número finito e maior que zero."
    );
  }
  return value;
}

function parseOptionalStops(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return null;
  return parseInteger(text, "O máximo de escalas", 0, 2);
}

function parseRegion(rawInput) {
  const airports = parseIataList(
    rawInput.region_airports,
    "Os aeroportos da região"
  );
  const name = String(rawInput.region_name ?? "").trim();
  if (!airports.length && !name) return null;
  if (!airports.length || !name) {
    throw new ValidationError(
      "A região exige um nome e ao menos um aeroporto explícito."
    );
  }
  if (name.length > 100 || CONTROL_CHARACTER_RE.test(name)) {
    throw new ValidationError("O nome da região é inválido.");
  }
  return { name, airports };
}

function dayNumber(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function calculateAuthorizedCombinations(rawInput) {
  const origins = parseIataList(rawInput.origins, "As origens", {
    required: true,
  });
  const destinations = parseIataList(rawInput.destinations, "Os destinos");
  const alternativeOrigins = parseIataList(
    rawInput.alternative_origins,
    "As origens alternativas"
  );
  const alternativeDestinations = parseIataList(
    rawInput.alternative_destinations,
    "Os destinos alternativos"
  );
  const region = parseRegion(rawInput);
  if (!destinations.length && !region) {
    throw new ValidationError("Informe ao menos um destino ou uma região.");
  }

  const departureStart = validateIsoDate(
    rawInput.departure_start,
    "A primeira data de ida"
  );
  const departureEnd = validateIsoDate(
    rawInput.departure_end,
    "A última data de ida"
  );
  const windowDays = dayNumber(departureEnd) - dayNumber(departureStart) + 1;
  if (windowDays < 1) {
    throw new ValidationError(
      "A última data de ida deve ser igual ou posterior à primeira."
    );
  }
  if (windowDays > MAX_DEPARTURE_WINDOW_DAYS) {
    throw new ValidationError(
      `A janela de partida aceita no máximo ${MAX_DEPARTURE_WINDOW_DAYS} dias.`
    );
  }

  const minStayDays = parseInteger(
    rawInput.min_stay_days,
    "A estadia mínima",
    1,
    MAX_STAY_DAYS
  );
  const maxStayDays = parseInteger(
    rawInput.max_stay_days,
    "A estadia máxima",
    1,
    MAX_STAY_DAYS
  );
  if (maxStayDays < minStayDays) {
    throw new ValidationError(
      "A estadia máxima deve ser igual ou maior que a mínima."
    );
  }

  const allOrigins = [...new Set([...origins, ...alternativeOrigins])];
  const allDestinations = [
    ...new Set([
      ...destinations,
      ...(region?.airports ?? []),
      ...alternativeDestinations,
    ]),
  ];
  const routeCount = allOrigins.reduce(
    (count, origin) =>
      count +
      allDestinations.filter((destination) => destination !== origin).length,
    0
  );
  const count =
    routeCount * windowDays * (maxStayDays - minStayDays + 1);
  if (count < 1) {
    throw new ValidationError("A busca não gerou combinações válidas.");
  }
  if (count > MAX_AUTHORIZED_COMBINATIONS) {
    throw new ValidationError(
      `A busca gera ${count} combinações; o limite é ${MAX_AUTHORIZED_COMBINATIONS}.`
    );
  }

  return {
    count,
    spec: {
      origins,
      destinations,
      region,
      alternative_origins: alternativeOrigins,
      alternative_destinations: alternativeDestinations,
      departure_start: departureStart,
      departure_end: departureEnd,
      min_stay_days: minStayDays,
      max_stay_days: maxStayDays,
      budget: parseOptionalBudget(rawInput.budget),
      max_stops: parseOptionalStops(rawInput.max_stops),
      priority: parseInteger(rawInput.priority ?? "50", "A prioridade", 1, 100),
      enabled: rawInput.enabled !== false,
      notifications_enabled: rawInput.notifications_enabled === true,
      authorized_combinations: count,
    },
  };
}

export function validateFlexibleInput(rawInput) {
  const id = validateFlightId(rawInput.id);
  const { count, spec } = calculateAuthorizedCombinations(rawInput);
  if (rawInput.confirmed_combinations !== count) {
    throw new ValidationError(
      "Revise a prévia e confirme novamente a quantidade de combinações."
    );
  }
  return {
    action: "add",
    id,
    mode: "flexible",
    flexible_spec: JSON.stringify(spec),
  };
}
