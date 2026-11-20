export const DEFAULT_BUSINESS_VAT_RATE = 15.5;

export function normalizeBusinessTaxProfile(row) {
  const rawRate = Number(row?.vat_rate ?? DEFAULT_BUSINESS_VAT_RATE);
  const vatRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100
    ? rawRate
    : DEFAULT_BUSINESS_VAT_RATE;

  return {
    vatRegistered: Boolean(row?.vat_registered),
    vatRate,
  };
}

export async function loadBusinessTaxProfile(supabase) {
  const { data, error } = await supabase
    .from("business_settings")
    .select("vat_registered,vat_rate")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error("Could not load business VAT settings: " + error.message);
  return normalizeBusinessTaxProfile(data);
}
