const MANIFEST_SCHEMA_VERSION = 1;
const MAX_CONTENT_BYTES = 1024 * 1024;
const PARTITION_PATH_RE = /^\d{4}\/\d{2}\/\d{2}-\d{3}\.jsonl$/;
const OBSERVATION_ID_RE = /^[a-f0-9]{64}$/;
const PERIOD_DAYS = new Map([
  ["7", 7],
  ["30", 30],
  ["90", 90],
]);

export class HistoryDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "HistoryDataError";
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finitePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validObservedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateManifest(value) {
  if (
    !isObject(value) ||
    value.schema_version !== MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.partitions)
  ) {
    throw new HistoryDataError("Manifesto de histórico incompatível.");
  }

  const seenPaths = new Set();
  const partitions = value.partitions.map((partition) => {
    if (
      !isObject(partition) ||
      !PARTITION_PATH_RE.test(partition.path ?? "") ||
      typeof partition.date !== "string" ||
      !Number.isInteger(partition.records) ||
      partition.records < 0 ||
      !Number.isInteger(partition.bytes) ||
      partition.bytes < 0 ||
      partition.bytes > MAX_CONTENT_BYTES
    ) {
      throw new HistoryDataError("Partição de histórico inválida.");
    }
    if (seenPaths.has(partition.path)) {
      throw new HistoryDataError("Manifesto contém partição duplicada.");
    }
    seenPaths.add(partition.path);
    return {
      path: partition.path,
      date: partition.date,
      records: partition.records,
      bytes: partition.bytes,
    };
  });

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    updated_at: value.updated_at ?? null,
    partitions,
  };
}

function validateObservation(value) {
  if (
    !isObject(value) ||
    value.schema_version !== MANIFEST_SCHEMA_VERSION ||
    !OBSERVATION_ID_RE.test(value.observation_id ?? "") ||
    typeof value.monitor_id !== "string" ||
    !value.monitor_id ||
    !validObservedAt(value.observed_at) ||
    typeof value.status !== "string" ||
    !value.status ||
    (value.price !== null && !finitePrice(value.price)) ||
    (value.carrier !== null && typeof value.carrier !== "string")
  ) {
    throw new HistoryDataError("Registro de histórico inválido.");
  }
  return value;
}

export function parseHistorySegment(content, partition) {
  if (typeof content !== "string") {
    throw new HistoryDataError("Conteúdo de histórico inválido.");
  }
  if (new TextEncoder().encode(content).byteLength !== partition.bytes) {
    throw new HistoryDataError("Tamanho da partição não confere com o manifesto.");
  }
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length !== partition.records) {
    throw new HistoryDataError("Contagem da partição não confere com o manifesto.");
  }

  return lines.map((line) => {
    try {
      return validateObservation(JSON.parse(line));
    } catch (error) {
      if (error instanceof HistoryDataError) throw error;
      throw new HistoryDataError("Partição contém JSON inválido.");
    }
  });
}

export function mergeHistorySegments(segments) {
  const records = segments.flat();
  const seenIds = new Set();
  for (const record of records) {
    if (seenIds.has(record.observation_id)) {
      throw new HistoryDataError("Histórico contém observação duplicada.");
    }
    seenIds.add(record.observation_id);
  }
  return [...records].sort(
    (left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at)
  );
}

export function filterHistory(records, monitorId, period, now = Date.now()) {
  if (period !== "all" && !PERIOD_DAYS.has(period)) {
    throw new HistoryDataError("Período de histórico inválido.");
  }
  const cutoff =
    period === "all" ? -Infinity : now - PERIOD_DAYS.get(period) * 86400000;
  return records.filter(
    (record) =>
      record.monitor_id === monitorId && Date.parse(record.observed_at) >= cutoff
  );
}

export function calculateStatistics(records) {
  const prices = records
    .filter((record) => finitePrice(record.price))
    .map((record) => record.price);
  if (!prices.length) {
    return {
      observations: records.length,
      prices: 0,
      current: null,
      minimum: null,
      maximum: null,
      mean: null,
      median: null,
      variation: null,
      variationPercent: null,
      volatility: null,
    };
  }

  const sorted = [...prices].sort((left, right) => left - right);
  const mean = prices.reduce((total, price) => total + price, 0) / prices.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  const first = prices[0];
  const current = prices[prices.length - 1];
  const variation = current - first;
  const variance =
    prices.reduce((total, price) => total + (price - mean) ** 2, 0) /
    prices.length;

  return {
    observations: records.length,
    prices: prices.length,
    current,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    mean,
    median,
    variation,
    variationPercent: (variation / first) * 100,
    volatility: Math.sqrt(variance),
  };
}

export function compareCarriers(records) {
  const grouped = new Map();
  for (const record of records) {
    const carrier = String(record.carrier ?? "").trim();
    if (!carrier || !finitePrice(record.price)) continue;
    const prices = grouped.get(carrier) ?? [];
    prices.push(record.price);
    grouped.set(carrier, prices);
  }
  return [...grouped.entries()]
    .map(([carrier, prices]) => ({
      carrier,
      observations: prices.length,
      minimum: Math.min(...prices),
      mean: prices.reduce((total, price) => total + price, 0) / prices.length,
    }))
    .sort((left, right) => left.mean - right.mean);
}

export function chartSeries(records) {
  return records
    .filter((record) => finitePrice(record.price))
    .map((record) => ({
      observedAt: record.observed_at,
      price: record.price,
    }));
}

export function safeResultUrl(rawValue) {
  if (typeof rawValue !== "string" || !rawValue) return null;
  try {
    const url = new URL(rawValue);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "google.com" && !url.hostname.endsWith(".google.com"))
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
