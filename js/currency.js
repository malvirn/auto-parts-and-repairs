// Shared USD → ZiG conversion rate. ZimRate publishes market rates every 30 minutes.
const API_URL = "https://zimrate.com/api/rates/latest";
const CACHE_KEY = "apr-zimrate-black-market-max-v1";
const CACHE_TTL = 30 * 60 * 1000;
let cachedRate = null;
let cachedAt = 0;
let cachedUpdatedAt = null;
let pendingRequest = null;

function numericRate(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function extractBlackMarketMax(payload) {
  const rows = [];
  const visit = (value, key = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(item => visit(item)); return; }
    const identity = [key, value.name, value.provider, value.label, value.type, value.rate_name, value.rate_type, value.market, value.source]
      .filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ");
    if (/black market max|blackmarketmax|parallel market max/.test(identity)) {
      const rate = numericRate(value.rate ?? value.value ?? value.buy_rate ?? value.sell_rate ?? value.buy ?? value.sell ?? value.amount ?? value.zig);
      if (rate) rows.push({ rate, updatedAt: value.updated_at ?? value.updatedAt ?? value.timestamp ?? value.date ?? null });
    }
    for (const [childKey, child] of Object.entries(value)) {
      const normalizedKey = childKey.toLowerCase().replace(/[_-]+/g, " ");
      if (/black market max|blackmarketmax|parallel market max/.test(normalizedKey)) {
        const rate = numericRate(child) ?? numericRate(child?.rate ?? child?.value ?? child?.buy_rate ?? child?.sell_rate ?? child?.buy ?? child?.sell);
        if (rate) rows.push({ rate, updatedAt: child?.updated_at ?? child?.updatedAt ?? child?.timestamp ?? null });
      }
      visit(child, childKey);
    }
  };
  visit(payload);
  return rows[0] || null;
}

function remember(rate, updatedAt = null) {
  cachedRate = rate;
  cachedAt = Date.now();
  cachedUpdatedAt = updatedAt || new Date(cachedAt).toISOString();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, updatedAt: cachedUpdatedAt, cachedAt })); } catch (_) {}
  return { rate, updatedAt: cachedUpdatedAt, source: "zimrate", stale: false };
}

function readSavedRate() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const rate = numericRate(saved?.rate);
    if (rate) return { rate, updatedAt: saved.updatedAt || null, source: "zimrate-cache", stale: true };
  } catch (_) {}
  return null;
}

export async function getRateDetails({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedRate && Date.now() - cachedAt < CACHE_TTL) {
    return { rate: cachedRate, updatedAt: cachedUpdatedAt, source: "zimrate", stale: false };
  }
  if (pendingRequest) return pendingRequest;
  pendingRequest = (async () => {
    try {
      const response = await fetch(API_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`ZimRate returned HTTP ${response.status}`);
      const payload = await response.json();
      const result = extractBlackMarketMax(payload);
      if (!result) throw new Error("ZimRate response did not contain a Black Market Max rate");
      return remember(result.rate, result.updatedAt);
    } catch (error) {
      console.warn("Couldn't refresh the ZimRate black market rate:", error);
      if (cachedRate) return { rate: cachedRate, updatedAt: cachedUpdatedAt, source: "zimrate-cache", stale: true };
      const saved = readSavedRate();
      if (saved) {
        cachedRate = saved.rate;
        cachedUpdatedAt = saved.updatedAt;
        return saved;
      }
      throw new Error("The current ZimRate exchange rate is unavailable. Check your connection and try again.");
    } finally {
      pendingRequest = null;
    }
  })();
  return pendingRequest;
}

export async function getRate() {
  return (await getRateDetails()).rate;
}

export function formatZig(usdAmount, rate) {
  return (usdAmount * rate).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
