import { timingSafeEqual } from "./crypto-utils.js";
import { createSessionToken, verifySessionToken } from "./session.js";

const OWNER = "tiagoirber";
const REPO = "flight-watcher";
const WORKFLOW = "manage-flights.yml";
const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const ALLOWED_PATH_PREFIXES = ["config/", "data/"];
const ALLOWED_EXACT_PATHS = [".github/workflows/monitor.yml"];
const ALLOWED_ORIGIN = "https://tiagoirber.github.io";
const LOGIN_FAILURE_DELAY_MS = 300;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function isAllowedRepoPath(path) {
  if (path.includes("..")) return false;
  if (ALLOWED_EXACT_PATHS.includes(path)) return true;
  return ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function requireSession(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  return verifySessionToken(token, env.SESSION_SECRET);
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "corpo inválido" }, 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(password, env.PANEL_PASSWORD)) {
    await new Promise((resolve) => setTimeout(resolve, LOGIN_FAILURE_DELAY_MS));
    return jsonResponse({ error: "senha incorreta" }, 401);
  }
  const token = await createSessionToken(env.SESSION_SECRET);
  return jsonResponse({ token });
}

async function proxyToGitHub(url, env, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "flight-watcher-proxy",
    },
  });
}

async function forwardGitHubResponse(githubResponse) {
  if (githubResponse.status === 204) {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const bodyText = await githubResponse.text();
  return new Response(bodyText, {
    status: githubResponse.status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function handleRepoRead(path, env) {
  if (!isAllowedRepoPath(path)) {
    return jsonResponse({ error: "caminho não permitido" }, 403);
  }
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const githubResponse = await proxyToGitHub(
    `${GITHUB_API}/contents/${encodedPath}?ref=master`,
    env
  );
  return forwardGitHubResponse(githubResponse);
}

async function handleDispatch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "corpo inválido" }, 400);
  }
  const githubResponse = await proxyToGitHub(
    `${GITHUB_API}/actions/workflows/${WORKFLOW}/dispatches`,
    env,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return forwardGitHubResponse(githubResponse);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname.startsWith("/repo/") && request.method === "GET") {
      if (!(await requireSession(request, env))) {
        return jsonResponse({ error: "sessão inválida ou expirada" }, 401);
      }
      const path = decodeURIComponent(url.pathname.slice("/repo/".length));
      return handleRepoRead(path, env);
    }

    if (url.pathname === "/dispatch" && request.method === "POST") {
      if (!(await requireSession(request, env))) {
        return jsonResponse({ error: "sessão inválida ou expirada" }, 401);
      }
      return handleDispatch(request, env);
    }

    return jsonResponse({ error: "não encontrado" }, 404);
  },
};
