// Header network-strength indicator: signal bars from measured round-trip time to the server,
// capped by the browser's reported connection type, and forced low when the app is offline / read-only.
import { SUPABASE_URL } from "./supabaseClient.js";
import { getConnectionState } from "./connectionManager.js";

const LABELS = ["Offline", "Poor", "Fair", "Good", "Excellent"];
const PROBE_EVERY_MS = 20000;
const PROBE_TIMEOUT_MS = 6000;
let rtt = null, failed = false, started = false, probing = false;

function level() {
  if (!navigator.onLine) return 0;
  const breaker = getConnectionState();
  if (breaker === "open") return 0;
  if (breaker === "half-open" || failed) return 1;
  let bars = rtt == null ? 3 : rtt < 300 ? 4 : rtt < 700 ? 3 : rtt < 1500 ? 2 : 1;
  const type = navigator.connection?.effectiveType;
  if (type === "slow-2g" || type === "2g") bars = Math.min(bars, 1);
  else if (type === "3g") bars = Math.min(bars, 2);
  return bars;
}

function update() {
  const el = document.getElementById("glass-net");
  if (!el) return;
  const bars = level();
  const detail = bars > 0 && rtt != null && !failed ? " · " + Math.round(rtt) + " ms" : "";
  const readOnly = getConnectionState() !== "closed" && navigator.onLine ? " · Read only" : "";
  el.dataset.level = String(bars);
  el.title = "Network: " + LABELS[bars] + detail + readOnly + " (tap to re-test)";
  el.setAttribute("aria-label", "Network strength: " + LABELS[bars]);
  const label = el.querySelector(".glass-net-label");
  if (label) label.textContent = LABELS[bars];
}

async function probe() {
  if (probing) return;
  if (!navigator.onLine) { rtt = null; failed = false; update(); return; }
  probing = true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = performance.now();
  try {
    // no-cors: any HTTP answer counts as "reachable", and we only need the timing.
    await fetch(SUPABASE_URL + "/auth/v1/health?t=" + Date.now(), { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    rtt = performance.now() - start; failed = false;
  } catch (_) { rtt = null; failed = true; }
  clearTimeout(timer);
  probing = false;
  update();
}

export function initNetworkStatus() {
  update();
  const el = document.getElementById("glass-net");
  if (el && !el.dataset.bound) { el.dataset.bound = "1"; el.addEventListener("click", probe); }
  if (started) return;
  started = true;
  window.addEventListener("online", probe);
  window.addEventListener("offline", update);
  window.addEventListener("apr:connection-change", update);
  navigator.connection?.addEventListener?.("change", () => { update(); probe(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) probe(); });
  setInterval(() => { if (!document.hidden) probe(); }, PROBE_EVERY_MS);
  probe();
}
