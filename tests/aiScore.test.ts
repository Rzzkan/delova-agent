import { beforeEach, describe, expect, it } from "vitest";
import { aiScoreListing, parseAi } from "../src/lib/aiScore";
import { checkDescription, checkTitle, PARAMS, rubricVersion } from "../src/lib/rubric";
import { SHOPEE_LIMITS } from "../src/lib/seo";
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
const sum = (c: { score: number }[]) => c.reduce((a, x) => a + x.score, 0);

describe("rubrik lokal", () => {
  it("judul sesuai format baku dapat nilai penuh", () => {
    const c = checkTitle("Delova Wardrobe - ARSY LONG OUTER Kebaya Brokat Wanita", "wardrobe", SHOPEE_LIMITS);
    expect(sum(c)).toBe(70);
  });
  it("menandai klaim terlarang dan format salah", () => {
    const c = checkTitle("ORIGINAL Best Seller Kebaya Murah", "wardrobe", SHOPEE_LIMITS);
    expect(c.find((x) => x.id === "format")!.score).toBe(0);
    expect(c.find((x) => x.id === "klaim")!.score).toBeLessThan(10);
  });
  it("scarf menyebut batik ditolak", () => {
    const c = checkTitle("Delova Scarf - Pashmina Printed Motif Batik", "scarf", SHOPEE_LIMITS);
    expect(c.find((x) => x.id === "kain")!.score).toBe(0);
  });
  it("kids: klaim medis dan menekan pembelian", () => {
    const c = checkDescription("Dress anak ini mencerdaskan dan menyembuhkan. Buruan checkout sekarang! " + "x".repeat(300), "kids", SHOPEE_LIMITS);
    expect(c.find((x) => x.id === "d_klaim")!.score).toBeLessThan(15);
  });
  it("versi rubrik stabil dan terisi", () => {
    expect(rubricVersion()).toBe(rubricVersion());
    expect(rubricVersion()).toMatch(/^2026-10-31\./);
    expect(PARAMS.filter((p) => p.part === "judul").reduce((a, p) => a + p.max, 0)).toBe(100);
    expect(PARAMS.filter((p) => p.part === "deskripsi").reduce((a, p) => a + p.max, 0)).toBe(100);
  });
});

describe("skor AI", () => {
  beforeEach(() => setStoreForTests(new MemStore()));
  const input = { platform: "shopee" as const, shop_id: "1", product_id: "9", brand: "wardrobe" as const, name: "Delova Wardrobe - ARSY LONG OUTER Kebaya Brokat Wanita", description: "Outer panjang bahan brokat. ".repeat(20), limits: SHOPEE_LIMITS };
  const good = JSON.stringify({ checks: [{ id: "kata_kunci", score: 18, note: "ok" }, { id: "karakter_judul", score: 10, note: "ok" }, { id: "d_kelengkapan", score: 24, note: "ok" }, { id: "d_fakta", score: 15, note: "ok" }, { id: "d_karakter", score: 9, note: "ok" }], summary: "Baik.", issues: [], suggested_title: "" });

  it("parseAi mengabaikan id tak dikenal dan menolak non-JSON", () => {
    expect(parseAi(`teks ${good} akhir`).checks).toHaveLength(5);
    expect(() => parseAi("bukan json")).toThrow();
    expect(() => parseAi('{"checks":[{"id":"asing","score":5}]}')).toThrow();
  });
  it("tanpa konfigurasi AI: tetap menilai lokal, tidak di-cache", async () => {
    const r = await aiScoreListing(input, { cfg: { baseUrl: "https://x/v1", apiKey: "", model: "" } });
    expect(r.ai_ok).toBe(false);
    expect(r.ai_error).toMatch(/belum dikonfigurasi/);
    expect(r.total).toBeGreaterThan(0);
  });
  it("AI berhasil: skor dihitung, cache dipakai, berubah bila isi/rubrik berubah", async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: good } }] }), { status: 200 }); }) as any;
    try {
      const cfg = { baseUrl: "https://kenari.id/v1", apiKey: "k", model: "m" };
      const a = await aiScoreListing(input, { cfg });
      expect(a.ai_ok).toBe(true);
      expect(a.total).toBeGreaterThan(85);
      expect(a.cached).toBe(false);
      const b = await aiScoreListing(input, { cfg });
      expect(b.cached).toBe(true);
      expect(calls).toBe(1);
      await aiScoreListing({ ...input, name: input.name + " Terbaru" }, { cfg });
      expect(calls).toBe(2);
    } finally { globalThis.fetch = orig; }
  });
});
