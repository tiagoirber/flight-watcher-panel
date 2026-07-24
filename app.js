import { validateFlightId, validateFlightInput } from "./validation.mjs";
import {
  calculateStatistics,
  chartSeries,
  compareCarriers,
  filterHistory,
  mergeHistorySegments,
  parseHistorySegment,
  safeResultUrl,
  validateManifest,
} from "./history.mjs";
import { calculateFlightScore } from "./score.mjs";
import { calculateRecommendation } from "./recommendation.mjs";
import { buildDashboard, parseScheduleInterval } from "./dashboard.mjs";
import {
  calculateAuthorizedCombinations,
  validateFlexibleInput,
} from "./flexible-search.mjs";
import { answerHistoryQuestion } from "./intelligence.mjs";

const WORKER_BASE_URL = "https://flight-watcher-proxy.tiagoirber.workers.dev";
const SESSION_STORAGE_KEY = "fw_session";

let panelSessionToken = "";
let historyRecords = [];
let historyLoadVersion = 0;
let scheduleIntervalMinutes = null;
let previewedCombinations = null;

const passwordInput = document.getElementById("password");
const loginStatus = document.getElementById("loginStatus");
const logElement = document.getElementById("log");
const flightsElement = document.getElementById("flights");
const loadHistoryButton = document.getElementById("loadHistoryButton");
const historyMonitor = document.getElementById("historyMonitor");
const historyPeriod = document.getElementById("historyPeriod");
const historyStatus = document.getElementById("historyStatus");
const historyContent = document.getElementById("historyContent");
const historySampleNotice = document.getElementById("historySampleNotice");
const priceChart = document.getElementById("priceChart");
const chartDescription = document.getElementById("chartDescription");
const carrierEmpty = document.getElementById("carrierEmpty");
const carrierTable = document.getElementById("carrierTable");
const carrierTableBody = document.getElementById("carrierTableBody");
const historyTableBody = document.getElementById("historyTableBody");
const flightScoreCard = document.getElementById("flightScoreCard");
const flightScoreValue = document.getElementById("flightScoreValue");
const flightScoreClassification = document.getElementById(
  "flightScoreClassification"
);
const flightScoreConfidence = document.getElementById("flightScoreConfidence");
const flightScoreJustifications = document.getElementById(
  "flightScoreJustifications"
);
const recommendationCard = document.getElementById("recommendationCard");
const recommendationHeadline = document.getElementById("recommendationHeadline");
const recommendationSummary = document.getElementById("recommendationSummary");
const recommendationConfidence = document.getElementById(
  "recommendationConfidence"
);
const recommendationReasons = document.getElementById("recommendationReasons");
const recommendationAverage = document.getElementById("recommendationAverage");
const recommendationTrend = document.getElementById("recommendationTrend");
const recommendationRarity = document.getElementById("recommendationRarity");
const recommendationDataUsed = document.getElementById("recommendationDataUsed");
const recommendationDisclaimer = document.getElementById(
  "recommendationDisclaimer"
);
const dashboardPeriod = document.getElementById("dashboardPeriod");
const systemHealthCard = document.getElementById("systemHealthCard");
const systemHealthLabel = document.getElementById("systemHealthLabel");
const systemHealthReason = document.getElementById("systemHealthReason");
const lastExecution = document.getElementById("lastExecution");
const nextExecution = document.getElementById("nextExecution");
const promotionTable = document.getElementById("promotionTable");
const promotionTableBody = document.getElementById("promotionTableBody");
const promotionEmpty = document.getElementById("promotionEmpty");
const lowestPricesList = document.getElementById("lowestPricesList");
const lowestPricesEmpty = document.getElementById("lowestPricesEmpty");
const largestDropsList = document.getElementById("largestDropsList");
const largestDropsEmpty = document.getElementById("largestDropsEmpty");
const largestRisesList = document.getElementById("largestRisesList");
const largestRisesEmpty = document.getElementById("largestRisesEmpty");
const destinationAverageList = document.getElementById(
  "destinationAverageList"
);
const destinationAverageEmpty = document.getElementById(
  "destinationAverageEmpty"
);
const carrierAverageList = document.getElementById("carrierAverageList");
const carrierAverageEmpty = document.getElementById("carrierAverageEmpty");
const monthAverageList = document.getElementById("monthAverageList");
const monthAverageEmpty = document.getElementById("monthAverageEmpty");
const monitoredRoutesTable = document.getElementById("monitoredRoutesTable");
const monitoredRoutesBody = document.getElementById("monitoredRoutesBody");
const monitoredRoutesEmpty = document.getElementById("monitoredRoutesEmpty");
const alertsEmpty = document.getElementById("alertsEmpty");
const alertsTable = document.getElementById("alertsTable");
const alertsTableBody = document.getElementById("alertsTableBody");
const failureSummary = document.getElementById("failureSummary");
const failuresEmpty = document.getElementById("failuresEmpty");
const failuresTable = document.getElementById("failuresTable");
const failuresTableBody = document.getElementById("failuresTableBody");
const flightMode = document.getElementById("f_mode");
const fixedFields = document.getElementById("fixedFields");
const flexibleFields = document.getElementById("flexibleFields");
const flexiblePreview = document.getElementById("flexiblePreview");
const authorizeFlexible = document.getElementById("x_authorize");
const authorizationText = document.getElementById("authorizationText");
const intelligenceForm = document.getElementById("intelligenceForm");
const intelligenceQuestion = document.getElementById("intelligenceQuestion");
const intelligencePeriod = document.getElementById("intelligencePeriod");
const intelligenceAskButton = document.getElementById("intelligenceAskButton");
const intelligenceStatus = document.getElementById("intelligenceStatus");
const intelligenceAnswer = document.getElementById("intelligenceAnswer");
const intelligenceFacts = document.getElementById("intelligenceFacts");
const intelligenceLimitations = document.getElementById(
  "intelligenceLimitations"
);

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function eraseLegacyStoredToken() {
  try {
    window.localStorage.removeItem("fw_token");
  } catch {
    // O painel continua funcional quando o navegador bloqueia storage.
  }
}

function loadStoredSession() {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function updateSessionStatus() {
  loginStatus.className = "muted";
  loginStatus.textContent = panelSessionToken
    ? "Sessão ativa neste navegador."
    : "Nenhuma sessão ativa. Entre com a senha do painel.";
}

function setSession(token) {
  panelSessionToken = token;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Sessão continua funcionando só para esta aba se o storage for bloqueado.
  }
  updateSessionStatus();
}

function clearSession() {
  panelSessionToken = "";
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignorado: já não há sessão para limpar nesse caso.
  }
  updateSessionStatus();
}

async function login(event) {
  event.preventDefault();
  const password = passwordInput.value;
  passwordInput.value = "";
  loginStatus.textContent = "Entrando…";
  loginStatus.className = "muted";
  try {
    const response = await fetch(`${WORKER_BASE_URL}/login`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw await responseError(response);
    const data = await response.json();
    setSession(data.token);
    loginStatus.textContent =
      "Sessão iniciada. Ela continua válida neste navegador até você sair.";
    loginStatus.className = "ok";
  } catch (error) {
    clearSession();
    loginStatus.textContent = `Erro ao entrar: ${error.message}`;
    loginStatus.className = "err";
  }
}

function logout() {
  clearSession();
  clearHistory();
  showLog("Sessão encerrada neste navegador.", true);
}

function showLog(message, ok) {
  logElement.textContent = message;
  logElement.classList.remove("flap-update");
  void logElement.offsetWidth; // força reflow para reiniciar a animação de flip
  logElement.className = `${ok ? "ok" : "err"} flap-update`;
}

function humanizeStatus(status) {
  const messages = {
    403: "Ação não permitida (caminho fora da lista liberada ou permissão insuficiente).",
    404: "Recurso não encontrado no servidor.",
    422: "O servidor recusou os dados enviados. Confira os campos e tente novamente.",
  };
  if (messages[status]) return messages[status];
  if (status >= 500) {
    return "O servidor encontrou um problema. Tente novamente em instantes.";
  }
  return `O servidor respondeu com um erro inesperado (HTTP ${status}).`;
}

async function responseError(response) {
  return new Error(humanizeStatus(response.status));
}

async function workerFetch(path, options = {}) {
  if (!panelSessionToken) {
    throw new Error("Entre com a senha do painel primeiro.");
  }

  const response = await fetch(`${WORKER_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${panelSessionToken}`,
    },
  });
  if (response.status === 401) {
    clearSession();
    throw new Error("Sessão expirada ou inválida. Entre novamente com a senha.");
  }
  return response;
}

function decodeBase64Utf8(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeRepositoryPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function loadRepositoryText(path) {
  const encodedPath = encodeRepositoryPath(path);
  const response = await workerFetch(`/repo/${encodedPath}`);
  if (!response.ok) throw await responseError(response);

  const data = await response.json();
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("O GitHub retornou conteúdo em formato inesperado.");
  }
  return decodeBase64Utf8(data.content);
}

function createBoardRowShell(id) {
  const item = document.createElement("li");
  item.className = "board-row flap-update";

  const main = document.createElement("div");
  main.className = "board-row-main";
  const strong = document.createElement("strong");
  strong.textContent = id;
  main.appendChild(strong);
  item.appendChild(main);

  const meta = document.createElement("div");
  meta.className = "board-row-meta";
  const metaText = document.createElement("span");
  meta.appendChild(metaText);
  const actions = document.createElement("div");
  actions.className = "board-row-actions";
  meta.appendChild(actions);
  item.appendChild(meta);

  return { item, main, metaText, actions };
}

function appendLifecycleButtons(container, id, enabled) {
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.textContent = enabled ? "Pausar" : "Retomar";
  statusButton.addEventListener("click", () =>
    changeFlightStatus(id, enabled ? "pause" : "resume")
  );
  container.appendChild(statusButton);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "danger";
  removeButton.textContent = "Remover";
  removeButton.dataset.confirming = "false";
  let confirmResetTimer = null;
  removeButton.addEventListener("click", () => {
    if (removeButton.dataset.confirming === "true") {
      clearTimeout(confirmResetTimer);
      removeButton.dataset.confirming = "false";
      removeButton.textContent = "Remover";
      removeFlight(id);
      return;
    }
    removeButton.dataset.confirming = "true";
    removeButton.textContent = "Confirmar remoção?";
    confirmResetTimer = setTimeout(() => {
      removeButton.dataset.confirming = "false";
      removeButton.textContent = "Remover";
    }, 4000);
  });
  container.appendChild(removeButton);
}

function createFlexibleFlightListItem(flight) {
  const id = String(flight.id ?? "sem-id");
  const enabled = flight.enabled !== false;
  const origins = [
    ...(flight.origins ?? []),
    ...(flight.alternative_origins ?? []),
  ];
  const destinations = [
    ...(flight.destinations ?? []),
    ...(flight.region?.airports ?? []),
    ...(flight.alternative_destinations ?? []),
  ];

  const { item, main, metaText, actions } = createBoardRowShell(id);
  main.appendChild(
    document.createTextNode(
      `${origins.join(", ") || "?"} → ${destinations.join(", ") || "?"}`
    )
  );
  metaText.textContent =
    `flexível · idas ${String(flight.departure_start ?? "?")} a ` +
    `${String(flight.departure_end ?? "?")} · ` +
    `${String(flight.authorized_combinations ?? "?")} combinações · ` +
    `${enabled ? "ativo" : "pausado"}`;

  appendLifecycleButtons(actions, id, enabled);
  return item;
}

function createFlightListItem(flight) {
  if (flight.mode === "flexible") {
    return createFlexibleFlightListItem(flight);
  }
  const id = String(flight.id ?? "sem-id");
  const origin = String(flight.origin ?? "?");
  const destination = String(flight.destination ?? "?");
  const departure = String(flight.departure ?? "?");
  const returnDate = String(flight.return ?? "?");
  const enabled = flight.enabled !== false;
  const alertText = flight.alert_below
    ? `avisa abaixo de R$ ${String(flight.alert_below)}`
    : "avisa sempre que mudar";

  const { item, main, metaText, actions } = createBoardRowShell(id);
  main.appendChild(document.createTextNode(`${origin} → ${destination}`));
  metaText.textContent =
    `${departure} a ${returnDate} · ${alertText} · ${enabled ? "ativo" : "pausado"}`;

  appendLifecycleButtons(actions, id, enabled);
  return item;
}

async function fetchFlightsList() {
  const content = JSON.parse(await loadRepositoryText("config/flights.json"));
  if (!Array.isArray(content.flights)) {
    throw new Error("A configuração não contém uma lista de voos válida.");
  }
  return content.flights;
}

function renderFlightsList(flights) {
  const rows = flights.map((flight) => createFlightListItem(flight));
  rows.forEach((row, index) => {
    row.style.animationDelay = `${Math.min(index * 40, 400)}ms`;
  });
  flightsElement.replaceChildren(...rows);
}

function findFlightById(flights, id) {
  return flights.find((flight) => String(flight.id) === id);
}

async function loadFlights() {
  try {
    renderFlightsList(await fetchFlightsList());
    showLog("Lista atualizada.", true);
  } catch (error) {
    showLog(`Erro ao carregar voos: ${error.message}`, false);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WRITE_CONFIRM_INTERVAL_MS = 10000;
const WRITE_CONFIRM_ATTEMPTS = 9;

async function confirmWriteLanded(sentMessage, isConfirmed) {
  showLog(`${sentMessage} Confirmando…`, true);
  for (let attempt = 0; attempt < WRITE_CONFIRM_ATTEMPTS; attempt += 1) {
    await delay(WRITE_CONFIRM_INTERVAL_MS);
    let flights;
    try {
      flights = await fetchFlightsList();
    } catch {
      continue;
    }
    renderFlightsList(flights);
    if (isConfirmed(flights)) {
      showLog(`${sentMessage} Confirmado na lista.`, true);
      return;
    }
  }
  const waitedSeconds = (WRITE_CONFIRM_ATTEMPTS * WRITE_CONFIRM_INTERVAL_MS) / 1000;
  showLog(
    `${sentMessage} Ainda não apareceu na lista depois de ${waitedSeconds}s. ` +
      "Clique em Atualizar lista mais tarde para conferir.",
    false
  );
}

function showHistoryStatus(message, ok = true) {
  historyStatus.textContent = message;
  historyStatus.className = ok ? "ok" : "err";
}

function clearHistory() {
  historyLoadVersion += 1;
  historyRecords = [];
  scheduleIntervalMinutes = null;
  historyMonitor.replaceChildren();
  historyContent.hidden = true;
  historyStatus.textContent = "";
  historyStatus.className = "muted";
  priceChart.replaceChildren();
  carrierTableBody.replaceChildren();
  historyTableBody.replaceChildren();
  promotionTableBody.replaceChildren();
  lowestPricesList.replaceChildren();
  largestDropsList.replaceChildren();
  largestRisesList.replaceChildren();
  destinationAverageList.replaceChildren();
  carrierAverageList.replaceChildren();
  monthAverageList.replaceChildren();
  monitoredRoutesBody.replaceChildren();
  alertsTableBody.replaceChildren();
  failuresTableBody.replaceChildren();
  loadHistoryButton.disabled = false;
  intelligenceAskButton.disabled = true;
  intelligenceAnswer.hidden = true;
  intelligenceStatus.textContent =
    "Carregue o histórico para fazer uma pergunta.";
  intelligenceStatus.className = "muted";
}

async function loadPartitions(partitions) {
  const results = new Array(partitions.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < partitions.length) {
      const index = nextIndex;
      nextIndex += 1;
      const partition = partitions[index];
      const content = await loadRepositoryText(
        `data/history/v1/${partition.path}`
      );
      results[index] = parseHistorySegment(content, partition);
    }
  }

  const workerCount = Math.min(4, partitions.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function populateHistoryMonitors(records) {
  const latestByMonitor = new Map();
  for (const record of records) latestByMonitor.set(record.monitor_id, record);

  const options = [...latestByMonitor.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monitorId, record]) => {
      const option = document.createElement("option");
      option.value = monitorId;
      option.textContent = `${monitorId} — ${String(record.origin ?? "?")} → ${String(
        record.destination ?? "?"
      )}`;
      if (record.search_group_id) {
        option.textContent = `${String(record.search_group_id)} · ${option.textContent}`;
      }
      return option;
    });
  historyMonitor.replaceChildren(...options);
}

function formatCurrency(value) {
  return value === null ? "—" : currencyFormatter.format(value);
}

function formatVariation(statistics) {
  if (statistics.variation === null) return "—";
  const sign = statistics.variation > 0 ? "+" : "";
  const percentSign = statistics.variationPercent > 0 ? "+" : "";
  return `${sign}${currencyFormatter.format(statistics.variation)} (${percentSign}${statistics.variationPercent.toFixed(1)}%)`;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function renderChart(records) {
  const series = chartSeries(records);
  priceChart.replaceChildren();
  if (!series.length) {
    chartDescription.textContent = "Não há preços para desenhar no período.";
    return;
  }

  const width = 800;
  const height = 280;
  const padding = 48;
  const prices = series.map((point) => point.price);
  const times = series.map((point) => Date.parse(point.observedAt));
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const priceRange = maximum - minimum || 1;
  const timeRange = lastTime - firstTime || 1;
  const x = (time) =>
    firstTime === lastTime
      ? width / 2
      : padding + ((time - firstTime) / timeRange) * (width - padding * 2);
  const y = (price) =>
    minimum === maximum
      ? height / 2
      : height - padding - ((price - minimum) / priceRange) * (height - padding * 2);

  priceChart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  priceChart.append(
    createSvgElement("line", {
      x1: padding,
      y1: padding,
      x2: padding,
      y2: height - padding,
      class: "chart-axis",
    }),
    createSvgElement("line", {
      x1: padding,
      y1: height - padding,
      x2: width - padding,
      y2: height - padding,
      class: "chart-axis",
    })
  );

  const maximumLabel = createSvgElement("text", {
    x: 4,
    y: padding + 4,
    class: "chart-label",
  });
  maximumLabel.textContent = formatCurrency(maximum);
  const minimumLabel = createSvgElement("text", {
    x: 4,
    y: height - padding + 4,
    class: "chart-label",
  });
  minimumLabel.textContent = formatCurrency(minimum);
  priceChart.append(maximumLabel, minimumLabel);

  const points = series
    .map((point) => `${x(Date.parse(point.observedAt))},${y(point.price)}`)
    .join(" ");
  priceChart.appendChild(
    createSvgElement("polyline", {
      points,
      class: "chart-line",
    })
  );

  for (const point of series) {
    const circle = createSvgElement("circle", {
      cx: x(Date.parse(point.observedAt)),
      cy: y(point.price),
      r: 4,
      class: "chart-point",
    });
    const title = createSvgElement("title");
    title.textContent = `${dateFormatter.format(new Date(point.observedAt))}: ${formatCurrency(point.price)}`;
    circle.appendChild(title);
    priceChart.appendChild(circle);
  }
  chartDescription.textContent = `${series.length} preços entre ${dateFormatter.format(
    new Date(series[0].observedAt)
  )} e ${dateFormatter.format(
    new Date(series[series.length - 1].observedAt)
  )}.`;
}

function appendCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function routeText(item) {
  return `${String(item.origin ?? "?")} → ${String(item.destination ?? "?")} (${String(
    item.monitorId ?? item.monitor_id ?? "sem-id"
  )})`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatMonth(value) {
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? monthFormatter.format(date) : value;
}

function renderTextList(element, values) {
  const items = values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  });
  element.replaceChildren(...items);
}

function renderDashboard() {
  const result = buildDashboard(historyRecords, {
    period: dashboardPeriod.value,
    now: Date.now(),
    intervalMinutes: scheduleIntervalMinutes,
  });
  setText(
    "dashboardSample",
    `${result.sample.queries} consultas, ${result.sample.prices} preços e ${result.sample.monitors} rotas no período.`
  );
  setText("dashboardQueries", String(result.sample.queries));
  setText("dashboardPrices", String(result.sample.prices));
  setText("dashboardRoutes", String(result.sample.monitors));
  setText("dashboardFailures", String(result.failedQueries.length));

  const { health, lastExecution: latestRun, nextExecution: expectedRun } =
    result.system;
  systemHealthCard.className = `health-card health-${health.level}`;
  systemHealthLabel.textContent = health.label;
  systemHealthReason.textContent = health.reason;
  systemHealthCard.setAttribute("aria-label", `${health.label}. ${health.reason}`);
  lastExecution.textContent = latestRun
    ? `${dateFormatter.format(new Date(latestRun.completedAt))} — ${latestRun.successes}/${latestRun.queries} sucessos`
    : "Nenhuma execução operacional registrada.";
  nextExecution.textContent = expectedRun
    ? `${dateFormatter.format(new Date(expectedRun))} — estimativa do cron`
    : "Cron compatível não disponível.";

  const promotionRows = result.promotionRanking.map((item) => {
    const row = document.createElement("tr");
    appendCell(row, String(item.rank));
    appendCell(row, routeText(item));
    const recommendationCell = appendCell(row, item.recommendation);
    recommendationCell.className = `promotion-${item.action}`;
    appendCell(
      row,
      item.score === null ? `— / ${item.confidence}%` : `${item.score}/100 — ${item.confidence}%`
    );
    appendCell(row, formatCurrency(item.current));
    appendCell(row, formatPercent(item.differenceFromMeanPercent));
    return row;
  });
  promotionTableBody.replaceChildren(...promotionRows);
  promotionTable.hidden = result.promotionRanking.length === 0;
  promotionEmpty.textContent = result.promotionRanking.length
    ? ""
    : "Nenhuma rota observada no período.";

  renderTextList(
    lowestPricesList,
    result.lowestPrices.map(
      (item) => `${routeText(item)}: ${formatCurrency(item.minimum)} em ${dateFormatter.format(
        new Date(item.minimumObservedAt)
      )}`
    )
  );
  lowestPricesEmpty.textContent = result.lowestPrices.length
    ? ""
    : "Nenhum preço válido no período.";
  renderTextList(
    largestDropsList,
    result.largestDrops.map(
      (item) => `${routeText(item)}: ${formatPercent(item.movementPercent)} (${formatCurrency(
        item.previous
      )} → ${formatCurrency(item.current)})`
    )
  );
  largestDropsEmpty.textContent = result.largestDrops.length
    ? ""
    : "Nenhuma queda com dois preços válidos no período.";
  renderTextList(
    largestRisesList,
    result.largestRises.map(
      (item) => `${routeText(item)}: ${formatPercent(item.movementPercent)} (${formatCurrency(
        item.previous
      )} → ${formatCurrency(item.current)})`
    )
  );
  largestRisesEmpty.textContent = result.largestRises.length
    ? ""
    : "Nenhuma alta com dois preços válidos no período.";

  renderTextList(
    destinationAverageList,
    result.destinationAverages.map(
      (item) => `${item.destination}: ${formatCurrency(item.mean)} (${item.prices} preços; mínimo ${formatCurrency(
        item.minimum
      )})`
    )
  );
  destinationAverageEmpty.textContent = result.destinationAverages.length
    ? ""
    : "Nenhum preço válido para calcular médias por destino.";
  renderTextList(
    carrierAverageList,
    result.carrierAverages.map(
      (item) => `${item.carrier}: ${formatCurrency(item.mean)} (${item.prices} preços; mínimo ${formatCurrency(
        item.minimum
      )})`
    )
  );
  carrierAverageEmpty.textContent = result.carrierAverages.length
    ? ""
    : "Dados de companhia ainda não estão disponíveis no histórico.";
  renderTextList(
    monthAverageList,
    result.monthlyAverages.map(
      (item) => `${formatMonth(item.month)}: ${formatCurrency(item.mean)} (${item.prices} preços)`
    )
  );
  monthAverageEmpty.textContent = result.monthlyAverages.length
    ? ""
    : "Nenhum preço válido para calcular médias mensais.";

  const monitoredRows = result.monitoredRoutes.map((item) => {
    const row = document.createElement("tr");
    appendCell(row, routeText(item));
    appendCell(row, String(item.queries));
    appendCell(row, String(item.prices));
    appendCell(row, String(item.failures));
    return row;
  });
  monitoredRoutesBody.replaceChildren(...monitoredRows);
  monitoredRoutesTable.hidden = result.monitoredRoutes.length === 0;
  monitoredRoutesEmpty.textContent = result.monitoredRoutes.length
    ? ""
    : "Nenhuma rota observada no período.";

  const alertRows = result.alerts.slice(0, 50).map((item) => {
    const row = document.createElement("tr");
    appendCell(row, dateFormatter.format(new Date(item.observed_at)));
    appendCell(row, routeText(item));
    appendCell(row, formatCurrency(item.price));
    appendCell(row, item.outcome === "sent" ? "Enviado" : "Falhou");
    return row;
  });
  alertsTableBody.replaceChildren(...alertRows);
  alertsTable.hidden = result.alerts.length === 0;
  alertsEmpty.textContent = result.alerts.length
    ? `${result.alerts.length} alertas no período; exibindo até 50.`
    : "Nenhum alerta no período.";

  const failureRows = result.failedQueries.slice(0, 50).map((item) => {
    const row = document.createElement("tr");
    appendCell(row, dateFormatter.format(new Date(item.observed_at)));
    appendCell(row, routeText(item));
    appendCell(row, item.status);
    appendCell(row, String(item.error_code ?? "sem-código"));
    return row;
  });
  failuresTableBody.replaceChildren(...failureRows);
  failuresTable.hidden = result.failedQueries.length === 0;
  failuresEmpty.textContent = result.failedQueries.length
    ? ""
    : "Nenhuma consulta com falha no período.";
  failureSummary.textContent = result.failureCodes.length
    ? `${result.failedQueries.length} falhas no período; exibindo até 50. ` +
      result.failureCodes
        .map((item) => `${item.errorCode}: ${item.queries}`)
        .join("; ")
    : "";
}

function renderCarrierComparison(records) {
  const comparisons = compareCarriers(records);
  carrierTableBody.replaceChildren();
  carrierEmpty.hidden = comparisons.length > 0;
  carrierTable.hidden = comparisons.length === 0;
  for (const comparison of comparisons) {
    const row = document.createElement("tr");
    appendCell(row, comparison.carrier);
    appendCell(row, String(comparison.observations));
    appendCell(row, formatCurrency(comparison.minimum));
    appendCell(row, formatCurrency(comparison.mean));
    carrierTableBody.appendChild(row);
  }
}

function renderHistoryTable(records) {
  const rows = [...records].reverse().map((record) => {
    const row = document.createElement("tr");
    appendCell(row, dateFormatter.format(new Date(record.observed_at)));
    appendCell(
      row,
      record.error_code ? `${record.status} (${record.error_code})` : record.status
    );
    appendCell(row, formatCurrency(record.price));
    appendCell(row, String(record.carrier ?? "—"));
    appendCell(
      row,
      !Number.isFinite(record.query_duration_ms)
        ? "—"
        : `${Math.round(record.query_duration_ms / 1000)} s`
    );
    const linkCell = appendCell(row, "—");
    const url = safeResultUrl(record.result_url);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      link.textContent = "Abrir";
      linkCell.replaceChildren(link);
    }
    return row;
  });
  historyTableBody.replaceChildren(...rows);
}

function renderFlightScore(result) {
  flightScoreCard.className = `score-card score-${result.band}`;
  flightScoreValue.textContent =
    result.score === null ? "—" : `${result.score}/100`;
  flightScoreClassification.textContent = result.classification;
  flightScoreConfidence.textContent = `${result.confidence}% — ${result.confidenceLabel}`;
  const reasons = result.justifications.map((justification) => {
    const item = document.createElement("li");
    item.textContent = justification;
    return item;
  });
  flightScoreJustifications.replaceChildren(...reasons);
  flightScoreCard.setAttribute(
    "aria-label",
    result.score === null
      ? "Flight Score indisponível por dados insuficientes"
      : `Flight Score ${result.score} de 100, ${result.classification}, confiança ${result.confidenceLabel}`
  );
}

function renderRecommendation(records, scoreResult) {
  const result = calculateRecommendation(records, scoreResult);
  recommendationCard.className = `recommendation-card recommendation-${result.action}`;
  recommendationHeadline.textContent = result.headline;
  recommendationSummary.textContent = result.summary;
  recommendationConfidence.textContent = `${result.confidence}% — ${result.confidenceLabel}`;
  recommendationAverage.textContent =
    result.signals.belowAverage?.label ?? "Média ainda indisponível.";
  recommendationTrend.textContent = result.signals.trend.label;
  recommendationRarity.textContent = result.signals.rarity.label;
  recommendationDataUsed.textContent = `${result.dataUsed.queries} consultas, ${result.dataUsed.prices} preços, ${result.dataUsed.distinctDays} dias, Flight Score ${
    result.dataUsed.score ?? "indisponível"
  }.`;
  recommendationDisclaimer.textContent = result.disclaimer;
  const reasons = result.reasons.map((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    return item;
  });
  recommendationReasons.replaceChildren(...reasons);
  recommendationCard.setAttribute(
    "aria-label",
    `${result.headline}, confiança ${result.confidenceLabel}`
  );
}

function renderHistory() {
  const monitorId = historyMonitor.value;
  if (!monitorId) {
    historyContent.hidden = true;
    showHistoryStatus("O histórico não contém monitores.", false);
    return;
  }

  renderDashboard();
  const records = filterHistory(
    historyRecords,
    monitorId,
    historyPeriod.value
  );
  const statistics = calculateStatistics(records);
  const scoreResult = calculateFlightScore(records);
  renderFlightScore(scoreResult);
  renderRecommendation(records, scoreResult);
  setText("statCurrent", formatCurrency(statistics.current));
  setText("statMinimum", formatCurrency(statistics.minimum));
  setText("statMaximum", formatCurrency(statistics.maximum));
  setText("statMean", formatCurrency(statistics.mean));
  setText("statMedian", formatCurrency(statistics.median));
  setText("statVariation", formatVariation(statistics));
  setText("statVolatility", formatCurrency(statistics.volatility));
  setText(
    "statSample",
    `${statistics.prices} preços / ${statistics.observations} consultas`
  );

  const distinctDates = new Set(
    records.map((record) => record.observed_at.slice(0, 10))
  ).size;
  historySampleNotice.textContent =
    statistics.prices < 3 || distinctDates < 3
      ? "Amostra curta: interprete tendência e volatilidade com cautela."
      : "";
  renderChart(records);
  renderCarrierComparison(records);
  renderHistoryTable(records);
  historyContent.hidden = false;
  showHistoryStatus(
    `${statistics.observations} consultas carregadas para o período.`,
    true
  );
}

function renderIntelligenceList(container, items) {
  const elements = items.map((item) => {
    const element = document.createElement("li");
    if (typeof item === "string") {
      element.textContent = item;
      return element;
    }
    const label = document.createElement("strong");
    label.textContent = `${item.label}: `;
    element.append(label, document.createTextNode(item.value));
    return element;
  });
  container.replaceChildren(...elements);
}

function intelligencePeriodText(period) {
  const focus = period.focus ? ` · ${period.focus}` : "";
  if (!period.firstObservation || !period.lastObservation) {
    return `${period.label}${focus} · sem observações`;
  }
  const first = dateFormatter.format(new Date(period.firstObservation));
  const last = dateFormatter.format(new Date(period.lastObservation));
  return `${period.label}${focus} · ${first} a ${last}`;
}

function askIntelligence() {
  try {
    if (!historyRecords.length) {
      throw new Error("Carregue o histórico antes de analisar.");
    }
    const result = answerHistoryQuestion(
      historyRecords,
      intelligenceQuestion.value,
      { period: intelligencePeriod.value }
    );
    setText("intelligenceHeadline", result.headline);
    setText("intelligenceText", result.answer);
    setText("intelligencePeriodResult", intelligencePeriodText(result.period));
    setText(
      "intelligenceSample",
      `${result.observations.queries} consultas / ` +
        `${result.observations.prices} preços`
    );
    const providers = result.source.providers.length
      ? result.source.providers.join(", ")
      : "sem provider observado";
    setText(
      "intelligenceSource",
      `${result.source.dataset} · ${providers} · sem fonte externa`
    );
    setText(
      "intelligenceConfidence",
      `${result.confidence.percentage}% · ${result.confidence.level}`
    );
    setText("intelligenceConfidenceBasis", result.confidence.basis);
    renderIntelligenceList(intelligenceFacts, result.facts);
    renderIntelligenceList(intelligenceLimitations, result.limitations);
    intelligenceAnswer.hidden = false;
    intelligenceStatus.textContent =
      result.intent === "unsupported"
        ? "Pergunta recusada com segurança."
        : "Resposta calculada exclusivamente com o histórico carregado.";
    intelligenceStatus.className =
      result.intent === "unsupported" ? "err" : "ok";
  } catch (error) {
    intelligenceAnswer.hidden = true;
    intelligenceStatus.textContent = `Não foi possível analisar: ${error.message}`;
    intelligenceStatus.className = "err";
  }
}

async function loadScheduleInterval() {
  try {
    const workflowText = await loadRepositoryText(
      ".github/workflows/monitor.yml"
    );
    return parseScheduleInterval(workflowText);
  } catch {
    return null;
  }
}

async function loadHistory() {
  const version = ++historyLoadVersion;
  loadHistoryButton.disabled = true;
  intelligenceAskButton.disabled = true;
  intelligenceAnswer.hidden = true;
  showHistoryStatus("Carregando histórico…", true);
  try {
    const manifestText = await loadRepositoryText(
      "data/history/v1/manifest.json"
    );
    const manifest = validateManifest(JSON.parse(manifestText));
    const [segments, intervalMinutes] = await Promise.all([
      loadPartitions(manifest.partitions),
      loadScheduleInterval(),
    ]);
    if (version !== historyLoadVersion) return;

    historyRecords = mergeHistorySegments(segments);
    scheduleIntervalMinutes = intervalMinutes;
    intelligenceAskButton.disabled = false;
    intelligenceStatus.textContent =
      "Histórico carregado. Escolha ou escreva uma pergunta suportada.";
    intelligenceStatus.className = "muted";
    populateHistoryMonitors(historyRecords);
    renderHistory();
  } catch (error) {
    if (version !== historyLoadVersion) return;
    historyContent.hidden = true;
    intelligenceAskButton.disabled = true;
    intelligenceAnswer.hidden = true;
    showHistoryStatus(`Erro ao carregar histórico: ${error.message}`, false);
  } finally {
    if (version === historyLoadVersion) loadHistoryButton.disabled = false;
  }
}

async function dispatch(inputs) {
  const response = await workerFetch("/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "master", inputs }),
  });
  if (response.status !== 204) throw await responseError(response);
}

function collectFlightInput() {
  return {
    id: document.getElementById("f_id").value,
    origin: document.getElementById("f_origin").value,
    destination: document.getElementById("f_destination").value,
    origin_name: document.getElementById("f_origin_name").value,
    destination_name: document.getElementById("f_destination_name").value,
    departure: document.getElementById("f_departure").value,
    return_date: document.getElementById("f_return").value,
    alert_below: document.getElementById("f_alert_below").value,
  };
}

function collectFlexibleInput() {
  return {
    id: document.getElementById("f_id").value,
    origins: document.getElementById("x_origins").value,
    alternative_origins: document.getElementById("x_alternative_origins").value,
    destinations: document.getElementById("x_destinations").value,
    alternative_destinations: document.getElementById(
      "x_alternative_destinations"
    ).value,
    region_name: document.getElementById("x_region_name").value,
    region_airports: document.getElementById("x_region_airports").value,
    departure_start: document.getElementById("x_departure_start").value,
    departure_end: document.getElementById("x_departure_end").value,
    min_stay_days: document.getElementById("x_min_stay").value,
    max_stay_days: document.getElementById("x_max_stay").value,
    budget: document.getElementById("x_budget").value,
    max_stops: document.getElementById("x_max_stops").value,
    priority: document.getElementById("x_priority").value,
    enabled: document.getElementById("x_enabled").checked,
    notifications_enabled: document.getElementById("x_notifications").checked,
  };
}

function invalidateFlexiblePreview() {
  previewedCombinations = null;
  authorizeFlexible.checked = false;
  authorizeFlexible.disabled = true;
  authorizationText.textContent = "Aguardando prévia.";
  flexiblePreview.textContent = "Calcule a prévia para autorizar a busca.";
  flexiblePreview.className = "notice";
}

function previewFlexibleSearch() {
  try {
    const preview = calculateAuthorizedCombinations(collectFlexibleInput());
    previewedCombinations = preview.count;
    authorizeFlexible.checked = false;
    authorizeFlexible.disabled = false;
    authorizationText.textContent =
      `Autorizo exatamente ${preview.count} combinações, processadas em ` +
      "lotes de até 8 consultas totais por execução.";
    flexiblePreview.textContent =
      `${preview.count} combinações válidas. O monitor percorre a fila ` +
      "gradualmente; voos fixos têm precedência.";
    flexiblePreview.className = "ok";
  } catch (error) {
    invalidateFlexiblePreview();
    flexiblePreview.textContent = `Prévia inválida: ${error.message}`;
    flexiblePreview.className = "err";
  }
}

async function addFlight() {
  try {
    const inputs =
      flightMode.value === "flexible"
        ? validateFlexibleInput({
            ...collectFlexibleInput(),
            confirmed_combinations: authorizeFlexible.checked
              ? previewedCombinations
              : null,
          })
        : { ...validateFlightInput(collectFlightInput()), mode: "fixed" };
    await dispatch(inputs);
    await confirmWriteLanded(
      `Voo '${inputs.id}' enviado para adição ou atualização.`,
      (flights) => Boolean(findFlightById(flights, inputs.id))
    );
  } catch (error) {
    showLog(`Erro ao adicionar ou atualizar: ${error.message}`, false);
  }
}

async function changeFlightStatus(rawId, action) {
  try {
    const id = validateFlightId(rawId);
    if (!["pause", "resume"].includes(action)) {
      throw new Error("Ação de status inválida.");
    }
    await dispatch({ action, id });
    const expectedEnabled = action === "resume";
    await confirmWriteLanded(
      `Monitoramento '${id}' enviado para ${
        action === "pause" ? "pausa" : "retomada"
      }.`,
      (flights) => {
        const flight = findFlightById(flights, id);
        return Boolean(flight) && (flight.enabled !== false) === expectedEnabled;
      }
    );
  } catch (error) {
    showLog(`Erro ao alterar status: ${error.message}`, false);
  }
}

async function removeFlight(rawId) {
  try {
    const id = validateFlightId(rawId);
    await dispatch({ action: "remove", id });
    await confirmWriteLanded(
      `Voo '${id}' enviado para remoção.`,
      (flights) => !findFlightById(flights, id)
    );
  } catch (error) {
    showLog(`Erro ao remover: ${error.message}`, false);
  }
}

document.getElementById("loginForm").addEventListener("submit", login);
document.getElementById("logoutButton").addEventListener("click", logout);

document.getElementById("loadFlightsButton").addEventListener("click", loadFlights);
loadHistoryButton.addEventListener("click", loadHistory);
historyMonitor.addEventListener("change", renderHistory);
historyPeriod.addEventListener("change", renderHistory);
dashboardPeriod.addEventListener("change", () => {
  if (historyRecords.length) renderDashboard();
});
intelligenceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askIntelligence();
});
document.getElementById("flightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  addFlight();
});
flightMode.addEventListener("change", () => {
  const flexible = flightMode.value === "flexible";
  fixedFields.hidden = flexible;
  flexibleFields.hidden = !flexible;
  invalidateFlexiblePreview();
});
flexibleFields.addEventListener("input", (event) => {
  if (event.target !== authorizeFlexible) invalidateFlexiblePreview();
});
document
  .getElementById("previewFlexibleButton")
  .addEventListener("click", previewFlexibleSearch);

eraseLegacyStoredToken();
panelSessionToken = loadStoredSession();
updateSessionStatus();
