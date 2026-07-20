import {
  looksLikeGitHubToken,
  validateFlightId,
  validateFlightInput,
} from "./validation.mjs";
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

const OWNER = "tiagoirber";
const REPO = "flight-watcher";
const WORKFLOW = "manage-flights.yml";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

let sessionToken = "";
let historyRecords = [];
let historyLoadVersion = 0;

const tokenInput = document.getElementById("token");
const tokenStatus = document.getElementById("tokenStatus");
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

function eraseLegacyStoredToken() {
  try {
    window.localStorage.removeItem("fw_token");
  } catch {
    // O painel continua funcional quando o navegador bloqueia storage.
  }
}

function getToken() {
  return sessionToken;
}

function updateTokenStatus() {
  tokenStatus.className = "muted";
  tokenStatus.textContent = getToken()
    ? "Token disponível somente nesta sessão."
    : "Nenhum token disponível nesta sessão.";
}

function saveToken() {
  const token = tokenInput.value.trim();
  if (!looksLikeGitHubToken(token)) {
    sessionToken = "";
    clearHistory();
    tokenStatus.textContent =
      "Isso não parece um token do GitHub. Confira o autofill e informe um " +
      "token iniciado por github_pat_ ou ghp_.";
    tokenStatus.className = "err";
    return;
  }
  if (sessionToken !== token) clearHistory();
  sessionToken = token;
  updateTokenStatus();
}

function clearToken() {
  sessionToken = "";
  tokenInput.value = "";
  eraseLegacyStoredToken();
  updateTokenStatus();
  clearHistory();
}

function showLog(message, ok) {
  logElement.textContent = message;
  logElement.className = ok ? "ok" : "err";
}

async function responseError(response) {
  const body = (await response.text()).slice(0, 1000);
  return new Error(`HTTP ${response.status}: ${body}`);
}

async function githubFetch(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error("Use um token nesta sessão primeiro.");

  return fetch(`${API}${path}`, {
    ...options,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      ...(options.headers || {}),
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });
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
  const response = await githubFetch(`/contents/${encodedPath}?ref=master`);
  if (!response.ok) throw await responseError(response);

  const data = await response.json();
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("O GitHub retornou conteúdo em formato inesperado.");
  }
  return decodeBase64Utf8(data.content);
}

function createFlightListItem(flight) {
  const item = document.createElement("li");
  const id = String(flight.id ?? "sem-id");
  const origin = String(flight.origin ?? "?");
  const destination = String(flight.destination ?? "?");
  const departure = String(flight.departure ?? "?");
  const returnDate = String(flight.return ?? "?");
  const alertText = flight.alert_below
    ? ` | avisa abaixo de R$ ${String(flight.alert_below)}`
    : " | avisa sempre que mudar";

  const strong = document.createElement("strong");
  strong.textContent = id;
  item.append(
    strong,
    document.createTextNode(
      `: ${origin} → ${destination} (${departure} a ${returnDate})${alertText} `
    )
  );

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remover";
  removeButton.addEventListener("click", () => removeFlight(id));
  item.appendChild(removeButton);
  return item;
}

async function loadFlights() {
  try {
    const content = JSON.parse(
      await loadRepositoryText("config/flights.json")
    );
    if (!Array.isArray(content.flights)) {
      throw new Error("A configuração não contém uma lista de voos válida.");
    }

    flightsElement.replaceChildren(
      ...content.flights.map((flight) => createFlightListItem(flight))
    );
    showLog("Lista atualizada.", true);
  } catch (error) {
    showLog(`Erro ao carregar voos: ${error.message}`, false);
  }
}

function showHistoryStatus(message, ok = true) {
  historyStatus.textContent = message;
  historyStatus.className = ok ? "ok" : "err";
}

function clearHistory() {
  historyLoadVersion += 1;
  historyRecords = [];
  historyMonitor.replaceChildren();
  historyContent.hidden = true;
  historyStatus.textContent = "";
  historyStatus.className = "muted";
  priceChart.replaceChildren();
  carrierTableBody.replaceChildren();
  historyTableBody.replaceChildren();
  loadHistoryButton.disabled = false;
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

function renderFlightScore(records) {
  const result = calculateFlightScore(records);
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

function renderHistory() {
  const monitorId = historyMonitor.value;
  if (!monitorId) {
    historyContent.hidden = true;
    showHistoryStatus("O histórico não contém monitores.", false);
    return;
  }

  const records = filterHistory(
    historyRecords,
    monitorId,
    historyPeriod.value
  );
  const statistics = calculateStatistics(records);
  renderFlightScore(records);
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

async function loadHistory() {
  const version = ++historyLoadVersion;
  loadHistoryButton.disabled = true;
  showHistoryStatus("Carregando histórico…", true);
  try {
    const manifestText = await loadRepositoryText(
      "data/history/v1/manifest.json"
    );
    const manifest = validateManifest(JSON.parse(manifestText));
    const segments = await loadPartitions(manifest.partitions);
    if (version !== historyLoadVersion) return;

    historyRecords = mergeHistorySegments(segments);
    populateHistoryMonitors(historyRecords);
    renderHistory();
  } catch (error) {
    if (version !== historyLoadVersion) return;
    historyContent.hidden = true;
    showHistoryStatus(`Erro ao carregar histórico: ${error.message}`, false);
  } finally {
    if (version === historyLoadVersion) loadHistoryButton.disabled = false;
  }
}

async function dispatch(inputs) {
  const response = await githubFetch(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
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

async function addFlight() {
  try {
    const inputs = validateFlightInput(collectFlightInput());
    await dispatch(inputs);
    showLog(
      `Voo '${inputs.id}' enviado para adição ou atualização. Pode levar cerca ` +
      "de um minuto para aparecer; depois clique em Atualizar lista.",
      true
    );
  } catch (error) {
    showLog(`Erro ao adicionar ou atualizar: ${error.message}`, false);
  }
}

async function removeFlight(rawId) {
  try {
    const id = validateFlightId(rawId);
    if (!window.confirm(`Remover o voo '${id}'?`)) return;
    await dispatch({ action: "remove", id });
    showLog(
      `Voo '${id}' enviado para remoção. Pode levar cerca de um minuto; ` +
      "depois clique em Atualizar lista.",
      true
    );
  } catch (error) {
    showLog(`Erro ao remover: ${error.message}`, false);
  }
}

document.getElementById("tokenForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveToken();
});

tokenInput.addEventListener("input", () => {
  if (tokenInput.value.trim() !== sessionToken) {
    sessionToken = "";
    updateTokenStatus();
    clearHistory();
  }
});

document.getElementById("clearTokenButton").addEventListener("click", clearToken);
document.getElementById("loadFlightsButton").addEventListener("click", loadFlights);
loadHistoryButton.addEventListener("click", loadHistory);
historyMonitor.addEventListener("change", renderHistory);
historyPeriod.addEventListener("change", renderHistory);
document.getElementById("flightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  addFlight();
});

eraseLegacyStoredToken();
updateTokenStatus();
