import supabase from './supabaseClient.js';

let cachedRate = null;

export async function getRate() {
  if (cachedRate) return cachedRate;
  const { data, error } = await supabase.from('settings').select('usd_to_zwg_rate').single();
  cachedRate = error ? 26.6908 : Number(data.usd_to_zwg_rate);
  return cachedRate;
}

export function formatZig(usdAmount, rate) {
  return (usdAmount * rate).toLocaleString('en-US', { maximumFractionDigits: 2 });
}