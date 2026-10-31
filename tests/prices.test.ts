import { describe, expect, it } from "vitest";
import { discountPct, shopeePrice, tiktokPrice } from "../src/lib/prices";

describe("harga", () => {
  it("Shopee: diskon bila current < original", () => {
    expect(shopeePrice({ price_info: [{ original_price: 100000, current_price: 75000 }] })).toEqual({ original: 100000, current: 75000, discount_pct: 25 });
  });
  it("Shopee: tanpa diskon, varian, dan tanpa price_info", () => {
    expect(shopeePrice({ price_info: [{ original_price: 72000, current_price: 72000 }], has_model: true })).toEqual({ original: 72000, current: 72000, discount_pct: null, variants: true });
    expect(shopeePrice({ price_info: [{ current_price: 50000 }] })?.original).toBe(50000);
    expect(shopeePrice({})).toBeUndefined();
  });
  it("TikTok: rentang harga SKU, harga string diterima", () => {
    expect(tiktokPrice({ skus: [{ price: { sale_price: "80000" } }, { price: { sale_price: 95000 } }] })).toMatchObject({ current: 80000, current_max: 95000, discount_pct: null, original: null });
    expect(tiktokPrice({ skus: [] })).toBeUndefined();
  });
  it("discountPct", () => {
    expect(discountPct(200, 150)).toBe(25);
    expect(discountPct(100, 100)).toBeNull();
    expect(discountPct(null, 10)).toBeNull();
  });
});
