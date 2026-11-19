// Shared USD → ZiG conversion rate, maintained by an authorised administrator.
import supabase from "./supabaseClient.js";

const CACHE_KEY = "centric-manual-bank-rate-v1";
const CACHE_TTL = 5 * 60 * 1000;
let cachedRate = null;
let cachedAt = 0;
let cachedUpdatedAt = null;
let pendingRequest = null;

function numericRate(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function remember(rate, updatedAt = null) {
  cachedRate = rate;
  cachedAt = Date.now();
  cachedUpdatedAt = updatedAt || new Date().toISOString();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      rate,
      updatedAt: cachedUpdatedAt,
      cachedAt: Date.now(),
    }));
  } catch (_) {}
  return { rate, updatedAt: cachedUpdatedAt, source: "manual-bank-rate", stale: false };
}

function readSavedRate() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const rate = numericRate(saved?.rate);
    if (rate) {
      cachedRate = rate;
      cachedAt = Number(saved.cachedAt || 0);
      cachedUpdatedAt = saved.updatedAt || null;
      return { rate, updatedAt: cachedUpdatedAt, source: "manual-bank-rate-cache", stale: true };
    }
  } catch (_) {}
  return null;
}

export async function getRateDetails({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedRate && Date.now() - cachedAt < CACHE_TTL) {
    return { rate: cachedRate, updatedAt: cachedUpdatedAt, source: "manual-bank-rate", stale: false };
  }
  if (pendingRequest) return pendingRequest;

  pendingRequest = (async () => {
    let data;
    try {
      const result = await supabase
        .from("business_settings")
        .select("usd_to_zig_bank_rate, exchange_rate_updated_at")
        .eq("id", 1)
        .limit(1)
        .maybeSingle();
      if (result.error) throw result.error;
      data = result.data;
    } catch (error) {
      const saved = readSavedRate();
      if (saved) return saved;
      throw new Error(error?.message || "Couldn't load the manually maintained bank exchange rate.");
    }

    const rate = numericRate(data?.usd_to_zig_bank_rate);
    if (!rate) throw new Error("The bank exchange rate has not been set. Ask a Super Admin to enter it in Settings.");
    try {
      return remember(rate, data.exchange_rate_updated_at);
    } finally {
      pendingRequest = null;
    }
  })().finally(() => {
    pendingRequest = null;
  });

  return pendingRequest;
}

export async function getRate() {
  return (await getRateDetails()).rate;
}

export function formatZig(usdAmount, rate) {
  return (usdAmount * rate).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
