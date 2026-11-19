import { getRate } from "./currency.js";

export async function exchangeRate(currencyCode) {
  const code = String(currencyCode || "USD");
  if (code === "USD") return 1;
  if (code !== "ZiG") throw new Error("Choose USD or ZiG.");
  const rate = Number(await getRate());
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Set the current bank rate in Settings before recording a ZiG payment.");
  return rate;
}

export async function usdEquivalent(tenderAmount, currencyCode) {
  const rate = await exchangeRate(currencyCode);
  const amount = Number(tenderAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than zero.");
  return { usdAmount: Math.round((amount / rate + Number.EPSILON) * 100) / 100, rate };
}

export function tenderLabel(amount, currencyCode) {
  const symbol = currencyCode === "ZiG" ? "ZiG " : "$";
  return symbol + Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
