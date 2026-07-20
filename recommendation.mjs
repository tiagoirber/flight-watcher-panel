const BUY_SCORE = 75;
const BUY_CONFIDENCE = 70;
const BELOW_AVERAGE_PERCENT = -1;
const TREND_THRESHOLD_PERCENT = 2;
const RARE_MINIMUM_PRICES = 10;
const RARE_MINIMUM_DAYS = 5;
const RARE_MAXIMUM_RANK_PERCENT = 10;
const RARE_MAXIMUM_MINIMUM_GAP_PERCENT = 5;

function pricedRecords(records) {
  return [...records]
    .filter(
      (record) =>
        typeof record.price === "number" &&
        Number.isFinite(record.price) &&
        record.price > 0
    )
    .sort(
      (left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at)
    );
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentageDifference(value, reference) {
  return ((value - reference) / reference) * 100;
}

function analyzeTrend(prices) {
  const recent = prices.slice(-5);
  if (recent.length < 2) {
    return {
      available: false,
      direction: "unavailable",
      changePercent: null,
      label: "Tendência ainda indisponível.",
    };
  }
  const changePercent = percentageDifference(
    recent[recent.length - 1],
    recent[0]
  );
  if (changePercent <= -TREND_THRESHOLD_PERCENT) {
    return {
      available: true,
      direction: "falling",
      changePercent,
      label: `Queda recente de ${Math.abs(changePercent).toFixed(1)}%.`,
    };
  }
  if (changePercent >= TREND_THRESHOLD_PERCENT) {
    return {
      available: true,
      direction: "rising",
      changePercent,
      label: `Alta recente de ${changePercent.toFixed(1)}%.`,
    };
  }
  return {
    available: true,
    direction: "stable",
    changePercent,
    label: `Preços recentes estáveis (${Math.abs(changePercent).toFixed(1)}%).`,
  };
}

function analyzeRarity(prices, distinctDays) {
  const current = prices[prices.length - 1];
  const minimum = Math.min(...prices);
  const eligible =
    prices.length >= RARE_MINIMUM_PRICES && distinctDays >= RARE_MINIMUM_DAYS;
  if (!eligible) {
    return {
      eligible: false,
      rare: false,
      rankPercent: null,
      minimumGapPercent: percentageDifference(current, minimum),
      label: `Raridade exige ${RARE_MINIMUM_PRICES} preços em ${RARE_MINIMUM_DAYS} dias.`,
    };
  }

  const lowerPrices = prices.filter((price) => price < current).length;
  const rankPercent = (lowerPrices / prices.length) * 100;
  const minimumGapPercent = percentageDifference(current, minimum);
  const rare =
    rankPercent <= RARE_MAXIMUM_RANK_PERCENT &&
    minimumGapPercent <= RARE_MAXIMUM_MINIMUM_GAP_PERCENT;
  return {
    eligible: true,
    rare,
    rankPercent,
    minimumGapPercent,
    label: rare
      ? "Preço raro: está entre os 10% menores e até 5% do mínimo."
      : "Preço não atende aos critérios históricos de raridade.",
  };
}

function averageSignal(current, average) {
  const differencePercent = percentageDifference(current, average);
  if (differencePercent <= BELOW_AVERAGE_PERCENT) {
    return {
      state: "below",
      differencePercent,
      label: `Preço ${Math.abs(differencePercent).toFixed(1)}% abaixo da média.`,
    };
  }
  if (differencePercent >= Math.abs(BELOW_AVERAGE_PERCENT)) {
    return {
      state: "above",
      differencePercent,
      label: `Preço ${differencePercent.toFixed(1)}% acima da média.`,
    };
  }
  return {
    state: "near",
    differencePercent,
    label: "Preço praticamente igual à média.",
  };
}

function insufficientRecommendation(records, scoreResult, prices, distinctDays) {
  const confidence = Number.isFinite(scoreResult?.confidence)
    ? scoreResult.confidence
    : 0;
  return {
    action: "insufficient",
    headline: "Aguardar mais dados",
    summary: "A amostra selecionada ainda não permite recomendar compra ou espera.",
    confidence,
    confidenceLabel: "insuficiente",
    reasons: [
      `Amostra atual: ${prices.length} preços em ${distinctDays} dias.`,
      "O Flight Score ainda não está elegível.",
    ],
    signals: {
      belowAverage: null,
      trend: analyzeTrend(prices),
      rarity: prices.length
        ? analyzeRarity(prices, distinctDays)
        : {
            eligible: false,
            rare: false,
            rankPercent: null,
            minimumGapPercent: null,
            label: "Raridade ainda indisponível.",
          },
    },
    dataUsed: {
      queries: records.length,
      prices: prices.length,
      distinctDays,
      score: null,
      confidence,
    },
    disclaimer:
      "Recomendação baseada apenas no histórico selecionado; não prevê preços futuros nem garante economia.",
  };
}

export function calculateRecommendation(records, scoreResult) {
  const orderedPrices = pricedRecords(records);
  const prices = orderedPrices.map((record) => record.price);
  const distinctDays = new Set(
    orderedPrices.map((record) => record.observed_at.slice(0, 10))
  ).size;
  if (!scoreResult?.eligible || !prices.length) {
    return insufficientRecommendation(
      records,
      scoreResult,
      prices,
      distinctDays
    );
  }

  const current = prices[prices.length - 1];
  const average = mean(prices);
  const belowAverage = averageSignal(current, average);
  const trend = analyzeTrend(prices);
  const rarity = analyzeRarity(prices, distinctDays);
  const conditions = {
    score: scoreResult.score >= BUY_SCORE,
    confidence: scoreResult.confidence >= BUY_CONFIDENCE,
    belowAverage: belowAverage.state === "below",
  };
  const shouldConsiderBuying = Object.values(conditions).every(Boolean);
  const reasons = [];
  if (shouldConsiderBuying) {
    reasons.push(`Flight Score ${scoreResult.score}, acima do mínimo ${BUY_SCORE}.`);
    reasons.push(
      `Confiança ${scoreResult.confidence}%, acima do mínimo ${BUY_CONFIDENCE}%.`
    );
    reasons.push(belowAverage.label);
  } else {
    if (!conditions.score) {
      reasons.push(
        `Flight Score ${scoreResult.score}; são necessários pelo menos ${BUY_SCORE}.`
      );
    }
    if (!conditions.confidence) {
      reasons.push(
        `Confiança ${scoreResult.confidence}%; são necessários pelo menos ${BUY_CONFIDENCE}%.`
      );
    }
    if (!conditions.belowAverage) reasons.push(belowAverage.label);
  }

  return {
    action: shouldConsiderBuying ? "buy" : "wait",
    headline: shouldConsiderBuying
      ? "Vale considerar comprar agora"
      : "Vale esperar e continuar monitorando",
    summary: shouldConsiderBuying
      ? "As condições históricas conservadoras de score, confiança e média foram atendidas."
      : "Uma ou mais condições conservadoras de compra ainda não foram atendidas.",
    confidence: scoreResult.confidence,
    confidenceLabel: scoreResult.confidenceLabel,
    reasons,
    conditions,
    signals: { belowAverage, trend, rarity },
    dataUsed: {
      queries: records.length,
      prices: prices.length,
      distinctDays,
      score: scoreResult.score,
      confidence: scoreResult.confidence,
    },
    disclaimer:
      "Recomendação baseada apenas no histórico selecionado; não prevê preços futuros nem garante economia.",
  };
}
