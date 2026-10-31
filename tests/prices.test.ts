import { describe, expect, it } from "vitest";
import { discountPct, shopeeModelPrice, shopeePrice, tiktokPrice } from "../src/lib/prices";

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
  it("produk bervarian: varian termurah + rentang + ada diskon", () => {
    const r = shopeeModelPrice([
      { price_info: [{ original_price: 90000, current_price: 90000 }] },
      { price_info: [{ original_price: 80000, current_price: 60000 }] },
      { price_info: [{ original_price: 85000, current_price: 85000 }] },
    ]);
    expect(r).toMatchObject({ original: 80000, current: 60000, current_max: 90000, discount_pct: 25, variants: true, any_discount: true });
    expect(shopeeModelPrice([])).toBeUndefined();
  });
});
