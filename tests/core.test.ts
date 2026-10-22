import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isAuthorized, oauthState } from "../src/lib/auth";
import { validateItems } from "../src/lib/flashSale";
import * as seo from "../src/lib/seo";
import { makeSign } from "../src/lib/shopee";

const hmac = (k: string, m: string) => createHmac("sha256", k).update(m).digest("hex");

describe("signing", () => {
  it("public API", () => {
    expect(makeSign("key", 123, "/api/v2/shop/auth_partner", 1700000000)).toBe(
      hmac("key", "123/api/v2/shop/auth_partner1700000000"),
    );
  });
  it("shop API", () => {
    expect(makeSign("key", 123, "/api/v2/product/get_item_list", 1700000000, "tok", 99)).toBe(
      hmac("key", "123/api/v2/product/get_item_list1700000000tok99"),
    );
  });
});

describe("seo", () => {
  it("aturan judul", () => {
    expect(seo.validateTitle("Kebaya").some((i) => i.includes("pendek"))).toBe(true);
    expect(seo.validateTitle("a".repeat(130)).some((i) => i.includes("panjang"))).toBe(true);
    expect(seo.validateTitle("KEBAYA MODERN WANITA TERBARU").some((i) => i.includes("KAPITAL"))).toBe(true);
    const good = "Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Kondangan Wisuda Lamaran";
    expect(seo.validateTitle(good)).toEqual([]);
  });
  it("blocking errors", () => {
    expect(seo.blockingErrors("x".repeat(10))).toHaveLength(1);
    expect(seo.blockingErrors(undefined, "d".repeat(3001))).toHaveLength(1);
    expect(seo.blockingErrors("Kebaya Modern Wanita Brokat Premium", "ok")).toEqual([]);
  });
});

describe("flash sale", () => {
  it("validasi item", () => {
    expect(validateItems([{ item_id: 1 }]).length).toBeGreaterThan(0);
    expect(validateItems([{ item_id: 1, purchase_limit: 2, item_input_promotion_price: 99000 }])).toEqual([]);
  });
});

describe("auth", () => {
  const secret = "s3cret-s3cret-s3cret";
  const r = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  it("bearer & query key", () => {
    expect(isAuthorized(r("https://x/api/mcp", { authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(isAuthorized(r(`https://x/api/mcp?key=${secret}`), secret)).toBe(true);
  });
  it("menolak salah / kosong / secret lemah", () => {
    expect(isAuthorized(r("https://x/api/mcp?key=salah"), secret)).toBe(false);
    expect(isAuthorized(r("https://x/api/mcp"), secret)).toBe(false);
    expect(isAuthorized(r("https://x/api/mcp?key="), "")).toBe(false);
    expect(isAuthorized(r("https://x/api/mcp?key=short"), "short")).toBe(false);
  });
  it("state oauth stabil", () => {
    expect(oauthState(secret)).toBe(oauthState(secret));
    expect(oauthState(secret)).not.toBe(oauthState(secret + "x"));
  });
});
