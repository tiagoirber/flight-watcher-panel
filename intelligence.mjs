import {
  buildDashboard,
  filterDashboardRecords,
} from "./dashboard.mjs";

const TIME_ZONE = "America/Sao_Paulo";
const PERIOD_LABELS = new Map([
  ["today", "Hoje"],
  ["7", "Últimos 7 dias"],
  ["30", "Últimos 30 dias"],
  ["90", "Últimos 90 dias"],
  ["all", "Todo o histórico"],
]);

export const SUPPORTED_QUESTIONS = Object.freeze([
  "Qual rota caiu mais?",
  "Qual destino está mais barato?",
  "Quais promoções apareceram hoje?",
  "Quais preços estão abaixo da média?",
  "Qual rota apresenta o melhor Flight Score?",
  "Quais rotas têm dados insuficientes?",
]);

function finitePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeNow(now) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(value)) {
    throw new TypeError("now precisa representar uma data válida");
  }
  return value;
}

function localDateKey(value) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function selectRecords(records, period, now) {
  if (!Array.isArray(records)) {
    throw new TypeError("records deve ser uma lista");
  }
  if (!PERIOD_LABELS.has(period)) {
    throw new RangeError("período da inteligência inválido");
  }
  if (period === "today") {
    const today = localDateKey(normalizeNow(now));
    return records
      .filter((record) => localDateKey(record.observed_at) === today)
      .sort(
        (left, right) =>
          Date.parse(left.observed_at) - Date.parse(right.observed_at)
      );
  }
  return filterDashboardRecords(records, period, now);
}

function classifyQuestion(rawQuestion) {
  const question = String(rawQuestion ?? "")
    .trim()
    .slice(0, 500)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (/\bpromo/.test(question)) return "promotions_today";
  if (/insuficient|poucos?\s+dados|falta\w*\s+dados/.test(question)) {
    return "insufficient_data";
  }
  if (/\bscore\b/.test(question)) return "best_score";
  if (/abaixo\s+da?\s+media|menor\s+que\s+a\s+media/.test(question)) {
    return "below_average";
  }
  if (
    /destino/.test(question) &&
    /(mais\s+barat|menor\s+preco|mais\s+em\s+conta)/.test(question)
  ) {
    return "cheapest_destination";
  }
  if (/(rota.*caiu|maior\s+queda|caiu\s+mais)/.test(question)) {
    return "largest_drop";
  }
  return "unsupported";
}

function confidenceLabel(percentage) {
  if (percentage < 35) return "baixa";
  if (percentage < 70) return "moderada";
  return "alta";
}

function aggregateConfidence(records) {
  const priced = records.filter((record) => finitePrice(record.price));
  const distinctDays = new Set(
    priced.map((record) => localDateKey(record.observed_at))
  ).size;
  const coverage = records.length ? priced.length / records.length : 0;
  const percentage = Math.round(
    (Math.min(priced.length / 20, 1) * 0.45 +
      Math.min(distinctDays / 7, 1) * 0.35 +
      coverage * 0.2) *
      100
  );
  return {
    percentage,
    level: confidenceLabel(percentage),
    basis:
      `${priced.length} preços em ${distinctDays} dias; ` +
      `${Math.round(coverage * 100)}% das consultas com preço.`,
  };
}

function confidenceFromScore(score, fallback) {
  if (!score || !Number.isFinite(score.confidence)) return fallback;
  return {
    percentage: score.confidence,
    level: score.confidenceLabel ?? confidenceLabel(score.confidence),
    basis:
      `${score.sample.prices} preços em ${score.sample.distinctDays} dias; ` +
      `${Math.round(score.sample.successRatio * 100)}% das consultas com preço.`,
  };
}

function periodMetadata(period, records) {
  const times = records
    .map((record) => Date.parse(record.observed_at))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    key: period,
    label: PERIOD_LABELS.get(period),
    firstObservation:
      times.length > 0 ? new Date(times[0]).toISOString() : null,
    lastObservation:
      times.length > 0 ? new Date(times[times.length - 1]).toISOString() : null,
  };
}

function sourceMetadata(records) {
  const providers = [
    ...new Set(
      records
        .map((record) => String(record.provider ?? "").trim())
        .filter(Boolean)
    ),
  ].sort();
  return {
    dataset: "Histórico persistente v1 do Flight Watcher",
    providers,
    externalSources: false,
  };
}

function currency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function percentage(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function routeLabel(route) {
  return `${route.origin} → ${route.destination} (${route.monitorId})`;
}

function baseResult(intent, period, records) {
  const pricedObservations = records.filter((record) =>
    finitePrice(record.price)
  ).length;
  return {
    intent,
    period: periodMetadata(period, records),
    observations: {
      queries: records.length,
      prices: pricedObservations,
    },
    source: sourceMetadata(records),
    confidence: aggregateConfidence(records),
    limitations: [
      "A análise usa somente observações persistidas no Flight Watcher.",
      "É uma descrição histórica: não prevê preços futuros nem garante economia.",
      "Falhas de coleta reduzem a amostra e a confiança.",
    ],
    facts: [],
  };
}

function largestDrop(result, dashboard) {
  const route = dashboard.largestDrops[0];
  result.headline = "Maior queda recente";
  if (!route) {
    result.answer =
      "Nenhuma rota possui duas observações de preço com queda no período.";
    return result;
  }
  result.answer =
    `${routeLabel(route)} apresentou a maior queda entre os dois preços ` +
    `válidos mais recentes: ${percentage(route.movementPercent)}.`;
  result.facts = [
    { label: "Rota", value: routeLabel(route) },
    { label: "Preço anterior", value: currency(route.previous) },
    { label: "Preço atual", value: currency(route.current) },
    { label: "Variação", value: percentage(route.movementPercent) },
  ];
  result.confidence = confidenceFromScore(route.score, result.confidence);
  return result;
}

function cheapestDestination(result, dashboard) {
  const routes = dashboard.promotionRanking
    .filter((route) => finitePrice(route.current))
    .sort(
      (left, right) =>
        left.current - right.current ||
        left.monitorId.localeCompare(right.monitorId)
    );
  const route = routes[0];
  result.headline = "Destino com menor preço atual";
  if (!route) {
    result.answer = "Nenhum preço atual válido está disponível no período.";
    return result;
  }
  result.answer =
    `${route.destination} é o destino com menor preço atual entre os ` +
    `monitoramentos analisados: ${currency(route.current)}, saindo de ${
      route.origin
    }.`;
  result.facts = [
    { label: "Destino", value: route.destination },
    { label: "Origem", value: route.origin },
    { label: "Preço atual", value: currency(route.current) },
    { label: "Monitor", value: route.monitorId },
  ];
  return result;
}

function promotionsToday(result, dashboard, now) {
  const today = localDateKey(normalizeNow(now));
  const promotions = dashboard.promotionRanking.filter(
    (route) =>
      route.action === "buy" &&
      route.currentObservedAt &&
      localDateKey(route.currentObservedAt) === today
  );
  result.period.focus = `Último preço da rota observado hoje (${today})`;
  result.headline = "Promoções identificadas hoje";
  result.limitations.push(
    "Promoção significa que a regra histórica de recomendação foi satisfeita; não é uma oferta garantida."
  );
  if (!promotions.length) {
    result.answer =
      "Nenhuma rota observada hoje satisfez todos os critérios históricos de compra.";
    return result;
  }
  result.answer =
    `${promotions.length} rota(s) observada(s) hoje satisfizeram os critérios ` +
    "históricos de compra.";
  result.facts = promotions.slice(0, 5).map((route) => ({
    label: routeLabel(route),
    value:
      `${currency(route.current)} · score ${route.score}/100 · ` +
      `${route.confidence}% de confiança`,
  }));
  result.confidence = {
    percentage: promotions[0].confidence,
    level: confidenceLabel(promotions[0].confidence),
    basis: `Confiança do Flight Score da promoção mais bem classificada.`,
  };
  return result;
}

function belowAverage(result, dashboard) {
  const routes = dashboard.promotionRanking
    .filter(
      (route) =>
        Number.isFinite(route.differenceFromMeanPercent) &&
        route.differenceFromMeanPercent < 0
    )
    .sort(
      (left, right) =>
        left.differenceFromMeanPercent - right.differenceFromMeanPercent ||
        left.monitorId.localeCompare(right.monitorId)
    );
  result.headline = "Preços atuais abaixo da média";
  if (!routes.length) {
    result.answer =
      "Nenhum preço atual está abaixo da média da própria rota no período.";
    return result;
  }
  result.answer =
    `${routes.length} rota(s) têm preço atual abaixo da própria média ` +
    "histórica do período.";
  result.facts = routes.slice(0, 5).map((route) => ({
    label: routeLabel(route),
    value:
      `${currency(route.current)} · ` +
      `${percentage(route.differenceFromMeanPercent)} versus a média`,
  }));
  return result;
}

function bestScore(result, dashboard) {
  const routes = dashboard.promotionRanking
    .filter((route) => Number.isFinite(route.score))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.confidence - left.confidence ||
        left.monitorId.localeCompare(right.monitorId)
    );
  const route = routes[0];
  result.headline = "Melhor Flight Score";
  if (!route) {
    result.answer =
      "Nenhuma rota possui amostra suficiente para calcular Flight Score.";
    return result;
  }
  result.answer =
    `${routeLabel(route)} apresenta o maior Flight Score do período: ` +
    `${route.score}/100, com ${route.confidence}% de confiança.`;
  result.facts = [
    { label: "Rota", value: routeLabel(route) },
    { label: "Flight Score", value: `${route.score}/100` },
    { label: "Confiança", value: `${route.confidence}%` },
    { label: "Preço atual", value: currency(route.current) },
  ];
  result.confidence = {
    percentage: route.confidence,
    level: confidenceLabel(route.confidence),
    basis: `Confiança calculada pelo Flight Score para ${route.monitorId}.`,
  };
  return result;
}

function insufficientData(result, dashboard) {
  const routes = dashboard.promotionRanking.filter(
    (route) => !Number.isFinite(route.score)
  );
  result.headline = "Rotas com dados insuficientes";
  if (!routes.length) {
    result.answer =
      "Todas as rotas do período possuem amostra mínima para Flight Score.";
    return result;
  }
  result.answer =
    `${routes.length} rota(s) ainda não atingiram a amostra mínima de três ` +
    "preços distribuídos em dois dias.";
  result.facts = routes.slice(0, 10).map((route) => ({
    label: routeLabel(route),
    value: `score indisponível · ${route.confidence}% de confiança`,
  }));
  return result;
}

export function answerHistoryQuestion(
  records,
  rawQuestion,
  { period = "all", now = Date.now() } = {}
) {
  const intent = classifyQuestion(rawQuestion);
  const effectivePeriod = period;
  const selected = selectRecords(records, effectivePeriod, now);
  const result = baseResult(intent, effectivePeriod, selected);

  if (intent === "unsupported") {
    result.headline = "Pergunta fora do escopo";
    result.answer =
      "Não encontrei uma intenção suportada. Escolha uma das perguntas documentadas.";
    result.limitations.push(
      "O assistente não completa perguntas desconhecidas nem consulta fontes externas."
    );
    result.facts = SUPPORTED_QUESTIONS.map((question) => ({
      label: "Pergunta suportada",
      value: question,
    }));
    return result;
  }

  const dashboard = buildDashboard(selected, {
    period: "all",
    now,
    intervalMinutes: null,
  });
  const handlers = {
    largest_drop: largestDrop,
    cheapest_destination: cheapestDestination,
    promotions_today: promotionsToday,
    below_average: belowAverage,
    best_score: bestScore,
    insufficient_data: insufficientData,
  };
  return handlers[intent](result, dashboard, now);
}
