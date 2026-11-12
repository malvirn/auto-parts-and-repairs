// Central connection health, circuit breaker, safe retries and offline read cache.
const SUPABASE_ORIGIN = "https://pztwmmkmkyotszylbhsr.supabase.co";
const DB_NAME = "apr-offline-cache";
const STORE_NAME = "rest-reads";
const MAX_CACHE_ENTRIES = 1200;
const MAX_RETRIES = 6;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const FAILURE_THRESHOLD = 3;
const OPEN_INTERVAL_MS = 30000;\nconst READ_ONLY_RPC = new Set([
  "get_unpriced_job_parts",
  "get_shop_job_part_purchase_requests",
  "get_accounting_job_part_purchase_requests",
  "get_technicians_admin",
  "job_card_part_catalog",\n]);

let state = "closed";
let consecutiveFailures = 0;
let retryAttempt = 0;
let nextProbeAt = 0;
let probePromise = null;
let dbPromise = null;
let banner = null;
let lastOnline = navigator.onLine !== false;

const nativeFetch = window.fetch.bind(window);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const jitter = ms => Math.round(ms * (0.8 + Math.random() * 0.4));

function currentUserKey(headers) {
  try {
    const auth = new Headers(headers).get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").split(".");
    if (token.length < 2) return "anonymous";
    const payload = JSON.parse(atob(token[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.sub || "anonymous");
  } catch (_) { return "anonymous"; }
}

function isCacheableRead(url, method, userKey) {
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== SUPABASE_ORIGIN || !parsed.pathname.startsWith("/rest/v1/")) return false;
    if (method === "GET") return true;
    const rpcName = parsed.pathname.split("/rpc/")[1]?.split("/")[0];
    return method === "POST" && userKey !== "anonymous" && READ_ONLY_RPC.has(rpcName);
  } catch (_) { return false; }
}

export function isReadOnlyRpc(name) { return READ_ONLY_RPC.has(String(name || "")); }

function cacheKey(url, headers, method = "GET", body = "") {
  return currentUserKey(headers) + ":" + method + ":" + url + (method === "POST" ? ":" + body : "");
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline cache could not open"));
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

async function readCached(url, headers, method = "GET", body = "") {
  try {
    const db = await openDb();
    const key = cacheKey(url, headers, method, body);
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    record.lastUsedAt = Date.now();
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record);
    return new Response(record.body, {
      status: record.status,
      statusText: record.statusText,
      headers: record.headers,
    });
  } catch (_) { return null; }
}

async function writeCached(url, headers, response, method = "GET", requestBody = "") {
  if (!response.ok || response.status === 206) return;
  try {
    const responseBody = await response.clone().arrayBuffer();
    const record = {
      key: cacheKey(url, headers, method, requestBody),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: responseBody,
      savedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      const all = store.getAll();
      all.onsuccess = () => {
        const records = all.result || [];
        if (records.length > MAX_CACHE_ENTRIES) {
          records.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
          records.slice(0, records.length - MAX_CACHE_ENTRIES).forEach(item => store.delete(item.key));
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("[connection] Could not update offline read cache:", error);
  }
}

function renderStatus() {
  if (!document.getElementById("apr-connection-status-style")) {
    const style = document.createElement("style");
    style.id = "apr-connection-status-style";
    style.textContent = `
      #apr-connection-status{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:9px;max-width:calc(100vw - 24px);padding:9px 15px;border:1px solid rgba(255,122,18,.4);border-radius:999px;background:rgba(32,24,18,.96);color:#ffe0c5;box-shadow:0 8px 28px rgba(0,0,0,.28);font:700 12px/1.2 Inter,system-ui,sans-serif;white-space:nowrap;pointer-events:none}
      #apr-connection-status[hidden]{display:none!important}
      .apr-connection-status__dot{width:8px;height:8px;flex:none;border-radius:50%;background:#ff8a3d;box-shadow:0 0 9px #ff8a3d}
      html[data-apr-connection="half-open"] #apr-connection-status__dot{background:#f3c35b;box-shadow:0 0 9px #f3c35b}
      @media(max-width:420px){#apr-connection-status{top:calc(env(safe-area-inset-top,0px) + 6px);font-size:11px;padding:8px 12px}}
    `;
    document.head.appendChild(style);
  }
  document.documentElement.dataset.aprConnection = state;
  if (!document.body) return;
  document.body.dataset.aprConnection = state;
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "apr-connection-status";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = '<span class="apr-connection-status__dot"></span><span class="apr-connection-status__text"></span>';
    document.body.appendChild(banner);
  }
  const text = banner.querySelector(".apr-connection-status__text");
  if (state === "closed") {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  text.textContent = state === "half-open"
    ? "Checking connection · Read only"
    : "Offline · Read only · Viewing saved data";
}

function setState(next) {
  if (state === next) return;
  state = next;
  renderStatus();
  window.dispatchEvent(new CustomEvent("apr:connection-change", {
    detail: { state, readOnly: state !== "closed" },
  }));
  if (state !== "closed") {
    console.warn("[connection] Circuit breaker:", state);
  } else {
    consecutiveFailures = 0;
    retryAttempt = 0;
    nextProbeAt = 0;
    console.info("[connection] Supabase connection restored.");
  }
}

function markSuccess() {
  consecutiveFailures = 0;
  retryAttempt = 0;
  if (state !== "closed") setState("closed");
  else renderStatus();
}

function markFailure(error) {
  consecutiveFailures += 1;
  retryAttempt += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** Math.max(0, retryAttempt - 1)));
    nextProbeAt = Date.now() + jitter(backoff);
    setState("open");
  }
  return error;
}

async function probeConnection() {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    if (navigator.onLine === false) return false;
    setState("half-open");
    try {
      const response = await nativeFetch(SUPABASE_ORIGIN + "/rest/v1/", {
        method: "GET",
        headers: { apikey: window.__APR_SUPABASE_ANON_KEY || "" },
        cache: "no-store",
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        markSuccess();
        return true;
      }
      throw new Error("Supabase health check returned " + response.status);
    } catch (error) {
      consecutiveFailures = FAILURE_THRESHOLD;
      retryAttempt += 1;
      const wait = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** Math.max(0, retryAttempt - 1)));
      nextProbeAt = Date.now() + jitter(wait);
      setState("open");
      return false;
    } finally { probePromise = null; }
  })();
  return probePromise;
}

async function maybeProbe() {
  if (state === "closed" || navigator.onLine === false || Date.now() < nextProbeAt) return;
  await probeConnection();
}

async function connectionFetch(input, init = {}) {
  const request = input instanceof Request ? input : null;
  const url = request ? request.url : String(input);
  const method = String(init.method || request?.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || request?.headers || {});
  const userKey = currentUserKey(headers);
  const requestBody = method === "POST" ? (typeof init.body === "string" ? init.body : request ? await request.clone().text().catch(() => "") : "") : "";
  const cacheable = isCacheableRead(url, method, userKey);
  const canRetry = method === "GET" || method === "HEAD";
  if (state === "open" || state === "half-open") {
    await maybeProbe();
    if (state !== "closed") {
      const cached = cacheable ? await readCached(url, headers, method, requestBody) : null;
      if (cached) return cached;
      throw new TypeError("Supabase is temporarily unavailable. The app is in read-only mode.");
    }
  }
  if (navigator.onLine === false) {
    setState("open");
    const cached = cacheable ? await readCached(url, headers, method, requestBody) : null;
    if (cached) return cached;
    throw new TypeError("You are offline. This record is not available in the saved cache.");
  }

  let attempt = 0;
  while (true) {
    try {
      const response = await nativeFetch(input, init);
      if (response.status >= 500 || response.status === 429) {
        if (response.status >= 500) markFailure(new Error("Supabase server error " + response.status));
        if (canRetry && attempt < MAX_RETRIES) {
          const delay = jitter(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** attempt)));
          attempt += 1;
          await sleep(delay);
          if (state !== "closed") {
            const cached = cacheable ? await readCached(url, headers, method, requestBody) : null;
            if (cached) return cached;
            throw new TypeError("Supabase is unavailable. The app is in read-only mode.");
          }
          continue;
        }
      } else if (response.ok) {
        markSuccess();
        if (cacheable) writeCached(url, headers, response, method, requestBody).catch(() => {});
      }
      return response;
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
      markFailure(error);
      if (!canRetry || attempt >= MAX_RETRIES || state !== "closed") {
        const cached = cacheable ? await readCached(url, headers, method, requestBody) : null;
        if (cached) return cached;
        throw error;
      }
      const delay = jitter(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** attempt)));
      attempt += 1;
      await sleep(delay);
    }
  }
}

// Route direct Supabase fetches (including Edge Functions and Storage) through
// the same breaker. Leave unrelated APIs and static assets untouched.
window.fetch = (input, init) => {
  try {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, location.href).origin === SUPABASE_ORIGIN) return connectionFetch(input, init);
  } catch (_) {}
  return nativeFetch(input, init);
};

export function isReadOnly() {
  return state !== "closed" || navigator.onLine === false;
}

export function assertWritable() {
  if (isReadOnly()) {
    const error = new Error("This system is in read-only mode. Reconnect to the internet before making changes.");
    error.code = "APR_READ_ONLY";
    throw error;
  }
}

export function getConnectionState() { return state; }
export { connectionFetch };

window.addEventListener("offline", () => {
  lastOnline = false;
  nextProbeAt = Date.now() + OPEN_INTERVAL_MS;
  setState("open");
});
window.addEventListener("online", () => {
  if (!lastOnline || state !== "closed") {
    lastOnline = true;
    nextProbeAt = 0;
    probeConnection();
  }
});
window.addEventListener("pageshow", renderStatus);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderStatus, { once: true });
else renderStatus();
setInterval(() => { if (state === "open") maybeProbe(); }, 5000);
