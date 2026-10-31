import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshness, stockAlerts, storeGet } from "../src/lib/delovaStore";

const cfg = { baseUrl: "https://delova.test/api/v1", apiKey: "k".repeat(32) };
const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...h } });

let calls: { url: string; key: string | null }[];
beforeEach(() => { calls = []; });
afterEach(() => vi.unstubAllGlobals());

function mock(fn: (u: URL) => Response) {
  vi.stubGlobal("fetch", async (u: URL, init: any) => { calls.push({ url: String(u), key: init.headers["X-API-Key"] }); return fn(u); });
}

describe("Delova Store API client", () => {
  it("kunci lewat header, bukan URL; parameter kosong dibuang", async () => {
    mock(() => json({ data: [] }));
    await storeGet("/products", { brand: "scarf", q: "", in_stock: true }, cfg);
    expect(calls[0].url).toBe("https://delova.test/api/v1/products?brand=scarf&in_stock=true");
    expect(calls[0].url).not.toContain(cfg.apiKey);
    expect(calls[0].key).toBe(cfg.apiKey);
  });
  it("tanpa kunci -> pesan jelas, tanpa memanggil jaringan", async () => {
    mock(() => json({}));
    await expect(storeGet("/shops", {}, { ...cfg, apiKey: "" })).rejects.toThrow(/DELOVA_API_KEY/);
    expect(calls).toHaveLength(0);
  });
  it("galat API: kode + request_id; 429 memuat Retry-After", async () => {
    mock(() => json({ error: { code: "rate_limited", message: "Terlalu banyak", request_id: "abc" } }, 429, { "retry-after": "30" }));
    await expect(storeGet("/stock", {}, cfg)).rejects.toThrow(/429 rate_limited.*30 detik.*abc/);
  });
  it("freshness menandai data lama", () => {
    const now = Date.parse("2026-10-31T00:00:00Z");
    expect(freshness("2026-10-22T00:00:00Z", now).note).toMatch(/9 hari/);
    expect(freshness("2026-10-30T20:00:00Z", now).age_hours).toBe(4);
    expect(freshness(null).age_hours).toBeNull();
  });
  it("stockAlerts menelusuri semua halaman", async () => {
    const p = (id: string, vs: number[]) => ({ id, name: `P${id}`, stock: vs.reduce((a, b) => a + b, 0), variants: vs.map((s, i) => ({ id: `${id}-${i}`, sku: `S${id}${i}`, name: `v${i}`, stock: s })) });
    mock((u) => json({ data: u.searchParams.get("page") === "1" ? [p("1", [0, 3, 20])] : [p("2", [5, 6])], meta: { total_pages: 2, last_sync_at: "2026-10-22T00:00:00Z" } }));
    const r = await stockAlerts({ brand: "scarf" }, 5, cfg);
    expect(r.out_of_stock.map((x) => x.sku)).toEqual(["S10"]);
    expect(r.low_stock.map((x) => x.sku)).toEqual(["S11", "S20"]);
    expect(r.products_checked).toBe(2);
    expect(calls).toHaveLength(2);
  });
});
