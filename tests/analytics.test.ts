import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import * as a from "../src/lib/analytics";
import { compactReport, insightFor, parseInsight } from "../src/lib/llm";
import { Store, setStoreForTests } from "../src/lib/store";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  async hget<T>(h: string, f: string) { const v = this.d[h]?.[f]; return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T); }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hsetMany(h: string, e: Record<string, unknown>) { for (const [k, v] of Object.entries(e)) await this.hset(h, k, v); }
  async hgetall<T>(h: string) { return JSON.parse(JSON.stringify(this.d[h] ?? {})) as Record<string, T>; }
  async lock() { return true; }
  async unlock() {}
}
beforeEach(() => setStoreForTests(new MemStore()));
afterEach(() => vi.unstubAllGlobals());

const o = (sn: string, status: string, lines: [number, number, number][]): a.OrderRec => ({ sn, day: "2026-10-30", status, total: 0, lines: lines.map(([item_id, qty, price]) => ({ item_id, name: `P${item_id}`, qty, revenue: qty * price })) });
const stat = (item_id: number, views: number, sold: number): a.ItemStat => ({ item_id, name: `P${item_id}`, views, sold_lifetime: sold, likes: 0, rating: 4.8, comments: 0 });

describe("hitung laporan", () => {
  it("omzet mengabaikan batal/belum bayar; retur dan rasio per produk", () => {
    const orders = [o("1", "COMPLETED", [[1, 2, 50000]]), o("2", "CANCELLED", [[1, 5, 50000]]), o("3", "SHIPPED", [[1, 3, 50000], [2, 1, 100000]])];
    const returns: a.ReturnRec[] = [{ sn: "r1", day: "2026-10-30", reason: "UKURAN", lines: [{ item_id: 1, qty: 1, refund: 50000 }] }, { sn: "r2", day: "2026-10-30", reason: "UKURAN", lines: [{ item_id: 1, qty: 1, refund: 50000 }] }];
    const rows = a.buildProducts(orders, returns, []);
    const p1 = rows.find((r) => r.item_id === 1)!;
    expect(p1.units).toBe(5);
    expect(p1.revenue).toBe(250000);
    expect(p1.return_units).toBe(2);
    expect(p1.return_rate).toBeCloseTo(0.4);
    expect(p1.return_reasons).toEqual(["UKURAN"]);
    const s = a.summarize(orders, returns, [{ date: "30-10-2026", impressions: 1000, clicks: 50, spend: 20000, gmv: 100000, orders: 2 }]);
    expect(s.orders).toBe(2);
    expect(s.cancelled).toBe(1);
    expect(s.revenue).toBe(350000);
    expect(s.roas).toBe(5);
    expect(s.acos).toBeCloseTo(0.2);
    expect(s.daily[0]).toMatchObject({ day: "2026-10-30", orders: 2, ad_spend: 20000 });
  });
  it("traffic tinggi + konversi rendah terdeteksi, urut views", () => {
    const rows = a.buildProducts([], [], [stat(1, 5000, 10), stat(2, 4000, 400), stat(3, 3000, 300), stat(4, 200, 20), stat(5, 150, 15), stat(6, 90, 1)]);
    const r = a.trafficLowConversion(rows);
    expect(r.rows.map((x) => x.item_id)).toEqual([1]);
    expect(r.rows[0].potential_orders).toBeGreaterThan(0);
    expect(a.trafficLowConversion(a.buildProducts([], [], [stat(1, 500, 1)])).rows).toEqual([]);
  });
  it("parseAds toleran terhadap bentuk respons", () => {
    expect(a.parseAds([{ date: "01-10-2026", impression: 10, clicks: 2, expense: 500, broad_order_amount: 9000, broad_order: 1 }])[0]).toMatchObject({ spend: 500, gmv: 9000, orders: 1 });
    expect(a.parseAds(undefined)).toEqual([]);
  });
  it("buildReport: satu bagian gagal tidak mematikan yang lain, dan di-cache", async () => {
    const calls: string[] = [];
    const c: any = {
      async shops() { return [{ shop_id: 5, shop_name: "Delova Kids" }]; },
      async get(_s: number, path: string, p: any) {
        calls.push(path);
        if (path.endsWith("get_order_list")) return { response: { order_list: [{ order_sn: "A1" }], more: false } };
        if (path.endsWith("get_order_detail")) return { response: { order_list: [{ order_sn: "A1", create_time: 1_761_800_000, order_status: "COMPLETED", item_list: [{ item_id: 1, item_name: "Kebaya", model_quantity_purchased: 2, model_discounted_price: 100000 }] }] } };
        if (path.endsWith("get_return_list")) throw new Error("error_permission");
        if (path.endsWith("get_all_cpc_ads_daily_performance")) return { response: [{ date: "30-10-2026", expense: 1000, broad_order_amount: 8000 }] };
        if (path.endsWith("get_item_list")) return { response: { item: [{ item_id: 1 }], has_next_page: false } };
        if (path.endsWith("get_item_base_info")) return { response: { item_list: [{ item_id: 1, item_name: "Kebaya" }] } };
        if (path.endsWith("get_item_extra_info")) return { response: { item_list: [{ item_id: 1, views: 300, sale: 3, likes: 1, rating_star: 4.9, comment_count: 0 }] } };
        throw new Error("unexpected " + path);
      },
    };
    const r = await a.buildReport(c, 5, 7);
    expect(r.shop_name).toBe("Delova Kids");
    expect(r.summary.revenue).toBe(200000);
    expect(r.summary.ad_spend).toBe(1000);
    expect(r.warnings.join()).toMatch(/Retur: error_permission/);
    const n = calls.length;
    await a.buildReport(c, 5, 7);
    expect(calls.length).toBe(n); // dari cache
  });
});

describe("insight AI", () => {
  it("parseInsight membaca JSON berpagar kode dan menyaring", () => {
    const i = parseInsight('Ini hasilnya:\n```json\n{"ringkasan":"ok","temuan":["a"],"tindakan":["b"],"produk":[{"item_id":1,"catatan":"x"},{"item_id":"zz","catatan":"y"}]}\n```');
    expect(i.ringkasan).toBe("ok");
    expect(i.produk).toEqual([{ item_id: 1, catatan: "x" }]);
    expect(() => parseInsight("tidak ada json")).toThrow();
  });
  it("insightFor memanggil /chat/completions dengan Bearer, tanpa data pembeli, lalu cache", async () => {
    const report: any = { shop_id: "5", shop_name: "Delova Kids", days: 7, from: "a", to: "b", warnings: [], truncated: false,
      summary: { orders: 1, cancelled: 0, units: 2, revenue: 200000, aov: 200000, return_count: 0, return_units: 0, return_rate: null, ad_spend: 0, ad_gmv: 0, roas: null, acos: null, tacos: null, ad_impressions: 0, ad_clicks: 0, daily: [] },
      top_sellers: [{ item_id: 1, name: "Kebaya", units: 2, revenue: 200000, orders: 1, return_units: 0, return_rate: null, return_reasons: [], views: 300, sold_lifetime: 3, conversion: 0.01, likes: 0, rating: 4.9 }],
      traffic_low_conversion: { median_conversion: null, rows: [] }, top_returns: [] };
    expect(JSON.stringify(compactReport(report))).not.toMatch(/buyer|username|email/);
    let hits = 0; let seen: any;
    vi.stubGlobal("fetch", async (u: string, init: any) => { hits++; seen = { u, auth: init.headers.authorization, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"ringkasan":"Bagus","temuan":[],"tindakan":["Naikkan stok"],"produk":[{"item_id":1,"catatan":"laris"},{"item_id":999,"catatan":"asing"}]}' } }] }), { status: 200 }); });
    const cfg = { baseUrl: "https://kenari.test/v1", apiKey: "KEY", model: "kenari-x" };
    const i = await insightFor(report, { cfg });
    expect(seen.u).toBe("https://kenari.test/v1/chat/completions");
    expect(seen.auth).toBe("Bearer KEY");
    expect(seen.body.model).toBe("kenari-x");
    expect(i.produk).toEqual([{ item_id: 1, catatan: "laris" }]);
    await insightFor(report, { cfg });
    expect(hits).toBe(1);
    await insightFor(report, { cfg, fresh: true });
    expect(hits).toBe(2);
  });
  it("tanpa kunci/model -> pesan jelas", async () => {
    await expect(insightFor({ shop_id: "9", days: 7 } as any, { cfg: { baseUrl: "https://kenari.id/v1", apiKey: "", model: "" } })).rejects.toThrow(/LLM_API_KEY/);
  });
});
