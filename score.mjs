const MINIMUM_PRICES = 3;
const MINIMUM_DAYS = 2;
const TARGET_PRICES = 20;
const TARGET_DAYS = 7;

const WEIGHTS = {
  historicalPosition: 0.3,
  meanDistance: 0.15,
  medianDistance: 0.15,
  minimumDistance: 0.15,
  recentTrend: 0.15,
  volatility: 0.1,
};

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values, average) {
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function referenceDistanceScore(current, reference) {
  return clamp(50 + ((reference - current) / reference) * 250);
}

function historicalPositionScore(prices, current) {
  if (prices.length < 2) return 50;
  const lower = prices.filter((price) => price < current).length;
  const equal = prices.filter((price) => price === current).length;
  const averageRank = lower + (equal - 1) / 2;
  return clamp(100 * (1 - averageRank / (prices.length - 1)));
}

function recentTrendScore(prices) {
  const recent = prices.slice(-5);
  if (recent.length < 2 || recent[0] === 0) return 50;
  const changePercent = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;
  return clamp(50 - changePercent * 5);
}

function confidenceFor(records, pricedRecords) {
  const priceCount = pricedRecords.length;
  const distinctDays = new Set(
    pricedRecords.map((record) => record.observed_at.slice(0, 10))
  ).size;
  const successRatio = records.length ? priceCount / records.length : 0;
  const value =
    Math.min(priceCount / TARGET_PRICES, 1) * 0.45 +
    Math.min(distinctDays / TARGET_DAYS, 1) * 0.35 +
    successRatio * 0.2;
  return {
    value,
    percentage: Math.round(value * 100),
    distinctDays,
    successRatio,
  };
}

export function classifyScore(score) {
  if (!Number.isFinite(score)) {
    return { label: "dados insuficientes", band: "insufficient" };
  }
  if (score >= 90) return { label: "excelente", band: "excellent" };
  if (score >= 75) return { label: "muito bom", band: "very-good" };
  if (score >= 60) return { label: "bom", band: "good" };
  if (score >= 40) return { label: "fraco", band: "weak" };
  return { label: "evitar", band: "avoid" };
}

function confidenceLabel(percentage) {
  if (percentage < 35) return "baixa";
  if (percentage < 70) return "moderada";
  return "alta";
}

function relativeDifference(current, reference) {
  return ((current - reference) / reference) * 100;
}

function describeReference(current, reference, name) {
  const difference = relativeDifference(current, reference);
  if (Math.abs(difference) < 1) return `Preço atual praticamente igual à ${name}.`;
  return `Preço atual ${Math.abs(difference).toFixed(1)}% ${
    difference < 0 ? "abaixo" : "acima"
  } da ${name}.`;
}

function buildJustifications({
  components,
  current,
  average,
  middle,
  minimum,
  prices,
  confidence,
}) {
  const justifications = [];
  if (components.historicalPosition >= 75) {
    justifications.push("Preço atual está entre os níveis mais baixos do período.");
  } else if (components.historicalPosition <= 25) {
    justifications.push("Preço atual está entre os níveis mais altos do período.");
  } else {
    justifications.push("Preço atual está na faixa intermediária do histórico.");
  }
  justifications.push(describeReference(current, average, "média"));
  justifications.push(describeReference(current, middle, "mediana"));

  const minimumGap = relativeDifference(current, minimum);
  justifications.push(
    Math.abs(minimumGap) < 1
      ? "Preço atual coincide com o menor preço observado."
      : `Preço atual está ${minimumGap.toFixed(1)}% acima do menor preço observado.`
  );

  const recent = prices.slice(-5);
  const trendChange = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;
  if (Math.abs(trendChange) < 1) {
    justifications.push("Preços recentes estão estáveis.");
  } else {
    justifications.push(
      `Tendência recente de ${trendChange < 0 ? "queda" : "alta"} (${Math.abs(
        trendChange
      ).toFixed(1)}%).`
    );
  }

  const coefficient = standardDeviation(prices, average) / average;
  const volatilityLabel =
    coefficient < 0.05 ? "baixa" : coefficient < 0.15 ? "moderada" : "elevada";
  justifications.push(
    `Volatilidade ${volatilityLabel} (${(coefficient * 100).toFixed(1)}% da média).`
  );
  justifications.push(
    `Confiança baseada em ${prices.length} preços, ${confidence.distinctDays} dias e ${(
      confidence.successRatio * 100
    ).toFixed(0)}% das consultas com preço.`
  );
  return justifications;
}

export function calculateFlightScore(records) {
  const ordered = [...records].sort(
    (left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at)
  );
  const pricedRecords = ordered.filter(
    (record) =>
      typeof record.price === "number" &&
      Number.isFinite(record.price) &&
      record.price > 0
  );
  const confidence = confidenceFor(ordered, pricedRecords);
  const sample = {
    queries: ordered.length,
    prices: pricedRecords.length,
    distinctDays: confidence.distinctDays,
    successRatio: confidence.successRatio,
  };

  if (
    pricedRecords.length < MINIMUM_PRICES ||
    confidence.distinctDays < MINIMUM_DAYS
  ) {
    return {
      eligible: false,
      score: null,
      rawScore: null,
      classification: "dados insuficientes",
      band: "insufficient",
      confidence: confidence.percentage,
      confidenceLabel: "insuficiente",
      sample,
      components: null,
      justifications: [
        `Amostra insuficiente: ${pricedRecords.length} preços em ${confidence.distinctDays} dias.`,
        `Mínimo necessário: ${MINIMUM_PRICES} preços em ${MINIMUM_DAYS} dias.`,
      ],
    };
  }

  const prices = pricedRecords.map((record) => record.price);
  const current = prices[prices.length - 1];
  const average = mean(prices);
  const middle = median(prices);
  const minimum = Math.min(...prices);
  const deviation = standardDeviation(prices, average);
  const components = {
    historicalPosition: historicalPositionScore(prices, current),
    meanDistance: referenceDistanceScore(current, average),
    medianDistance: referenceDistanceScore(current, middle),
    minimumDistance: clamp(100 - ((current - minimum) / minimum) * 200),
    recentTrend: recentTrendScore(prices),
    volatility: clamp(100 - (deviation / average) * 200),
  };
  const rawScore = Object.entries(WEIGHTS).reduce(
    (total, [component, weight]) => total + components[component] * weight,
    0
  );
  const score = Math.round(50 + (rawScore - 50) * confidence.value);
  const classification = classifyScore(score);

  return {
    eligible: true,
    score,
    rawScore,
    classification: classification.label,
    band: classification.band,
    confidence: confidence.percentage,
    confidenceLabel: confidenceLabel(confidence.percentage),
    sample,
    components,
    justifications: buildJustifications({
      components,
      current,
      average,
      middle,
      minimum,
      prices,
      confidence,
    }),
  };
}
