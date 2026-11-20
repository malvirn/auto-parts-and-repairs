import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_VAT_RATE, normalizeBusinessTaxProfile } from "../js/business-tax.js";

describe("business VAT settings", () => {
  it("uses the configured default rate when no settings row exists", () => {
    expect(normalizeBusinessTaxProfile(null)).toEqual({
      vatRegistered: false,
      vatRate: DEFAULT_BUSINESS_VAT_RATE,
    });
    expect(DEFAULT_BUSINESS_VAT_RATE).toBe(15.5);
  });

  it("uses the one saved business rate when registered", () => {
    expect(normalizeBusinessTaxProfile({ vat_registered: true, vat_rate: 14.5 })).toEqual({
      vatRegistered: true,
      vatRate: 14.5,
    });
  });

  it("keeps an unregistered business from applying VAT", () => {
    const profile = normalizeBusinessTaxProfile({ vat_registered: false, vat_rate: 15.5 });
    expect(profile.vatRegistered).toBe(false);
    expect(profile.vatRate).toBe(15.5);
  });

  it("falls back safely when the saved rate is invalid", () => {
    expect(normalizeBusinessTaxProfile({ vat_registered: true, vat_rate: 101 }).vatRate).toBe(15.5);
    expect(normalizeBusinessTaxProfile({ vat_registered: true, vat_rate: -1 }).vatRate).toBe(15.5);
  });
});
