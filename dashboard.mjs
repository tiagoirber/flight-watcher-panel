import { calculateFlightScore } from "./score.mjs";
import { calculateRecommendation } from "./recommendation.mjs";

const PERIOD_DAYS = new Map([
  ["7", 7],
  ["30", 30],
  ["90", 90],
]);
const FAILURE_STATUSES = new Set([
  "scrape_failed",
  "notification_failed",
  "error",
]);
const ACTION_ORDER = new Map([
  ["buy", 0],
  ["wait", 1],
  ["insufficient", 2],
]);

function finitePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function observedTime(record) {
  return Date.parse(record.observed_at);
}

function orderedRecords(records) {
  return [...records].sort((left, right) => {
    const timeDifference = observedTime(left) - observedTime(right);
    if (timeDifference) return timeDifference;
    const leftIdentity = String(
      left.observation_id ?? `${left.monitor_id}|${left.run_id}|${left.status}`
    );
    const rightIdentity = String(
      right.observation_id ?? `${right.monitor_id}|${right.run_id}|${right.status}`
    );
    return leftIdentity.localeCompare(rightIdentity);
  });
}

function groupBy(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = key(record);
    if (value === null || value === undefined || value === "") continue;
    const group = groups.get(value) ?? [];
    group.push(record);
    groups.set(value, group);
  }
  return groups;
}

function routeIdentity(records, monitorId) {
  const latest = records[records.length - 1] ?? {};
  return {
    monitorId,
    origin: String(latest.origin ?? "?"),
    destination: String(latest.destination ?? "?"),
  };
}

function averageRows(records, key, labelName) {
  return [...groupBy(records.filter((record) => finitePrice(record.price)), key)]
    .map(([label, group]) => {
      const prices = group.map((record) => record.price);
      return {
        [labelName]: label,
        prices: prices.length,
        mean: prices.reduce((total, price) => total + price, 0) / prices.length,
        minimum: Math.min(...prices),
      };
    })
    .sort((left, right) => left.mean - right.mean || String(left[labelName]).localeCompare(String(right[labelName])));
}

function summarizeRoutes(records) {
  return [...groupBy(orderedRecords(records), (record) => record.monitor_id)].map(
    ([monitorId, routeRecords]) => {
      const identity = routeIdentity(routeRecords, monitorId);
      const priced = routeRecords.filter((record) => finitePrice(record.price));
      const score = calculateFlightScore(routeRecords);
      const recommendation = calculateRecommendation(routeRecords, score);
      const failures = routeRecords.filter((record) => FAILURE_STATUSES.has(record.status)).length;
      const currentRecord = priced[priced.length - 1] ?? null;
      const previousRecord = priced[priced.length - 2] ?? null;
      const minimum = priced.length
        ? priced.reduce((best, record) => (record.price < best.price ? record : best))
        : null;
      const movementPercent =
        currentRecord && previousRecord
          ? ((currentRecord.price - previousRecord.price) / previousRecord.price) * 100
          : null;
      return {
        ...identity,
        queries: routeRecords.length,
        prices: priced.length,
        failures,
        current: currentRecord?.price ?? null,
        currentObservedAt: currentRecord?.observed_at ?? null,
        minimum: minimum?.price ?? null,
        minimumObservedAt: minimum?.observed_at ?? null,
        previous: previousRecord?.price ?? null,
        movementPercent,
        score,
        recommendation,
      };
    }
  );
}

function promotionRanking(routes) {
  return [...routes]
    .sort((left, right) => {
      const actionDifference =
        (ACTION_ORDER.get(left.recommendation.action) ?? 99) -
        (ACTION_ORDER.get(right.recommendation.action) ?? 99);
      if (actionDifference) return actionDifference;
      const scoreDifference = (right.score.score ?? -1) - (left.score.score ?? -1);
      if (scoreDifference) return scoreDifference;
      const confidenceDifference = right.score.confidence - left.score.confidence;
      if (confidenceDifference) return confidenceDifference;
      const leftAverage = left.recommendation.signals.belowAverage?.differencePercent ?? Infinity;
      const rightAverage = right.recommendation.signals.belowAverage?.differencePercent ?? Infinity;
      return leftAverage - rightAverage || left.monitorId.localeCompare(right.monitorId);
    })
    .map((route, index) => ({
      rank: index + 1,
      monitorId: route.monitorId,
      origin: route.origin,
      destination: route.destination,
      current: route.current,
      score: route.score.score,
      confidence: route.score.confidence,
      action: route.recommendation.action,
      recommendation: route.recommendation.headline,
      differenceFromMeanPercent:
        route.recommendation.signals.belowAverage?.differencePercent ?? null,
    }));
}

function operationalSummary(records, now, intervalMinutes) {
  const operational = records.filter(
    (record) =>
      record.status !== "imported" &&
      typeof record.run_id === "string" &&
      !record.run_id.startsWith("migration:")
  );
  const runs = [...groupBy(operational, (record) => record.run_id)]
    .map(([runId, runRecords]) => {
      const ordered = orderedRecords(runRecords);
      const failures = ordered.filter((record) => FAILURE_STATUSES.has(record.status)).length;
      return {
        runId,
        startedAt: ordered[0].observed_at,
        completedAt: ordered[ordered.length - 1].observed_at,
        queries: ordered.length,
        successes: ordered.filter((record) => record.status === "success").length,
        failures,
        alertsSent: ordered.filter((record) => record.notification_sent === true).length,
      };
    })
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt));
  const lastExecution = runs[runs.length - 1] ?? null;
  const nextExecution = calculateNextExecution(now, intervalMinutes);

  if (!lastExecution) {
    return {
      health: {
        level: "unknown",
        label: "Saúde desconhecida",
        reason: "Ainda não há execução operacional registrada.",
      },
      lastExecution,
      nextExecution,
      intervalMinutes,
    };
  }

  const nowTime = normalizeNow(now);
  const ageMinutes = Math.max(0, (nowTime - Date.parse(lastExecution.completedAt)) / 60000);
  const stale = Number.isInteger(intervalMinutes) && ageMinutes > intervalMinutes * 3;
  let health;
  if (stale || lastExecution.successes === 0) {
    health = {
      level: "critical",
      label: "Saúde crítica",
      reason: stale
        ? `Última execução há ${Math.floor(ageMinutes)} minutos; limite de ${intervalMinutes * 3}.`
        : "A última execução não teve consultas bem-sucedidas.",
    };
  } else if (lastExecution.failures > 0) {
    health = {
      level: "attention",
      label: "Saúde requer atenção",
      reason: `${lastExecution.failures} de ${lastExecution.queries} consultas falharam na última execução.`,
    };
  } else {
    health = {
      level: "healthy",
      label: "Sistema saudável",
      reason: `As ${lastExecution.queries} consultas da última execução foram concluídas com sucesso.`,
    };
  }
  return { health, lastExecution, nextExecution, intervalMinutes };
}

function normalizeNow(now) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(value)) throw new TypeError("now precisa representar uma data válida");
  return value;
}

export function parseScheduleInterval(workflowText) {
  if (typeof workflowText !== "string") return null;
  const match = workflowText.match(
    /^\s*-\s*cron:\s*["']\*\/(\d+)\s+\*\s+\*\s+\*\s+\*["']\s*$/m
  );
  if (!match) return null;
  const interval = Number(match[1]);
  return Number.isInteger(interval) && interval > 0 && interval <= 60 && 60 % interval === 0
    ? interval
    : null;
}

export function calculateNextExecution(now, intervalMinutes) {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 60) {
    return null;
  }
  const nowTime = normalizeNow(now);
  const intervalMs = intervalMinutes * 60000;
  return new Date((Math.floor(nowTime / intervalMs) + 1) * intervalMs).toISOString();
}

export function filterDashboardRecords(records, period, now = Date.now()) {
  if (period !== "all" && !PERIOD_DAYS.has(period)) {
    throw new RangeError("período estatístico inválido");
  }
  const cutoff =
    period === "all" ? -Infinity : normalizeNow(now) - PERIOD_DAYS.get(period) * 86400000;
  return orderedRecords(records).filter((record) => observedTime(record) >= cutoff);
}

export function buildDashboard(
  records,
  { period = "all", now = Date.now(), intervalMinutes = null } = {}
) {
  const selected = filterDashboardRecords(records, period, now);
  const routes = summarizeRoutes(selected);
  const priced = selected.filter((record) => finitePrice(record.price));
  const failedQueries = selected
    .filter((record) => FAILURE_STATUSES.has(record.status))
    .sort((left, right) => observedTime(right) - observedTime(left));
  const alerts = selected
    .filter((record) => record.notification_required === true)
    .sort((left, right) => observedTime(right) - observedTime(left))
    .map((record) => ({
      ...record,
      outcome: record.notification_sent === true ? "sent" : "failed",
    }));
  const failureCodes = [...groupBy(failedQueries, (record) => record.error_code ?? "unknown")]
    .map(([errorCode, group]) => ({ errorCode, queries: group.length }))
    .sort((left, right) => right.queries - left.queries || left.errorCode.localeCompare(right.errorCode));

  return {
    period,
    sample: {
      queries: selected.length,
      prices: priced.length,
      monitors: routes.length,
    },
    promotionRanking: promotionRanking(routes),
    lowestPrices: routes
      .filter((route) => route.minimum !== null)
      .sort((left, right) => left.minimum - right.minimum || left.monitorId.localeCompare(right.monitorId)),
    largestDrops: routes
      .filter((route) => route.movementPercent !== null && route.movementPercent < 0)
      .sort((left, right) => left.movementPercent - right.movementPercent || left.monitorId.localeCompare(right.monitorId)),
    largestRises: routes
      .filter((route) => route.movementPercent !== null && route.movementPercent > 0)
      .sort((left, right) => right.movementPercent - left.movementPercent || left.monitorId.localeCompare(right.monitorId)),
    alerts,
    destinationAverages: averageRows(priced, (record) => record.destination, "destination"),
    carrierAverages: averageRows(
      priced,
      (record) => String(record.carrier ?? "").trim() || null,
      "carrier"
    ),
    monthlyAverages: averageRows(
      priced,
      (record) => record.observed_at.slice(0, 7),
      "month"
    ).sort((left, right) => right.month.localeCompare(left.month)),
    monitoredRoutes: [...routes].sort(
      (left, right) => right.queries - left.queries || left.monitorId.localeCompare(right.monitorId)
    ),
    failedQueries,
    failureCodes,
    system: operationalSummary(records, now, intervalMinutes),
  };
}
