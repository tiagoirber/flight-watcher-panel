import {
  looksLikeGitHubToken,
  validateFlightId,
  validateFlightInput,
} from "./validation.mjs";

const OWNER = "tiagoirber";
const REPO = "flight-watcher";
const WORKFLOW = "manage-flights.yml";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

let sessionToken = "";

const tokenInput = document.getElementById("token");
const tokenStatus = document.getElementById("tokenStatus");
const logElement = document.getElementById("log");
const flightsElement = document.getElementById("flights");

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
    tokenStatus.textContent =
      "Isso não parece um token do GitHub. Confira o autofill e informe um " +
      "token iniciado por github_pat_ ou ghp_.";
    tokenStatus.className = "err";
    return;
  }
  sessionToken = token;
  updateTokenStatus();
}

function clearToken() {
  sessionToken = "";
  tokenInput.value = "";
  eraseLegacyStoredToken();
  updateTokenStatus();
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
    const response = await githubFetch("/contents/config/flights.json");
    if (!response.ok) throw await responseError(response);

    const data = await response.json();
    const content = JSON.parse(decodeBase64Utf8(data.content));
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
  }
});

document.getElementById("clearTokenButton").addEventListener("click", clearToken);
document.getElementById("loadFlightsButton").addEventListener("click", loadFlights);
document.getElementById("flightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  addFlight();
});

eraseLegacyStoredToken();
updateTokenStatus();
