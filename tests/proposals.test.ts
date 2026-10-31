import { beforeEach, describe, expect, it } from "vitest";
import * as pr from "../src/lib/proposals";
import { brandOf, scoreDescription, scoreTitle } from "../src/lib/scoring";
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

const OLD = "KEBAYA BROKAT!!";
const GOOD = "Kebaya Brokat Modern Wanita Premium Set Rok Batik Lilit Baju Pesta Kondangan Resepsi";
const DESC = "Kebaya brokat modern dengan bahan premium yang nyaman dipakai seharian untuk acara resmi maupun santai. ".repeat(3);

function fake(items: Record<string, { name: string; desc: string }>) {
  const calls: string[] = [];
  const c: any = {
    calls,
    async get(_s: number, path: string, p: any) {
      const ids = String(p.item_id_list).split(",");
      return { response: { item_list: ids.filter((i) => items[i]).map((i) => ({ item_id: Number(i), item_name: items[i].name, item_status: "NORMAL", description_type: "normal", description: items[i].desc })) } };
    },
    async post(_s: number, path: string, b: any) {
      calls.push(path);
      if (b.item_name) items[String(b.item_id)].name = b.item_name;
      if (b.description) items[String(b.item_id)].desc = b.description;
      return { response: {} };
    },
  };
  return c;
}

beforeEach(() => setStoreForTests(new MemStore()));

describe("skor", () => {
  it("judul bagus = A, judul buruk turun", () => {
    expect(scoreTitle(GOOD, SHOPEE_LIMITS).grade).toBe("A");
    const bad = scoreTitle(OLD, SHOPEE_LIMITS);
    expect(bad.score).toBeLessThan(60);
    expect(bad.notes.join()).toMatch(/pendek/);
  });
  it("deskripsi: pendek dihukum, panjang cukup = 100", () => {
    expect(scoreDescription("pendek", SHOPEE_LIMITS).score).toBeLessThan(70);
    expect(scoreDescription(DESC, SHOPEE_LIMITS).score).toBe(100);
  });
  it("brand dari nama toko", () => {
    expect([brandOf("Delova Kids"), brandOf("Delova Wardrobe Scarf"), brandOf("Delova Daily"), brandOf("Delova Wardrobe"), brandOf(null)]).toEqual(["kids", "scarf", "daily", "wardrobe", "wardrobe"]);
  });
});

describe("usulan -> persetujuan", () => {
  it("usulan tidak menulis ke marketplace; setuju baru menulis dan bisa dibatalkan", async () => {
    const items = { "1": { name: OLD + " panjang cukup untuk lolos", desc: DESC }, "2": { name: GOOD, desc: DESC } };
    const c = fake(items);
    const r = await pr.createProposals({ shopee: c }, "shopee", "9", "Delova Kids", [
      { item_id: 1, name: GOOD, note: "judul lebih lengkap" },
      { item_id: 2, name: GOOD },          // sama -> dilewati
      { item_id: 3, name: GOOD },          // tidak ada -> dilewati
      { item_id: 1, name: "x" },           // terlalu pendek -> dilewati
    ]);
    expect(r.created).toHaveLength(1);
    expect(r.created[0].brand).toBe("kids");
    expect(r.created[0].after.title.score).toBeGreaterThan(r.created[0].before.title.score);
    expect(r.skipped.map((s) => s.item_id).sort()).toEqual(["1", "2", "3"]);
    expect(c.calls).toHaveLength(0); // belum ada tulis

    const [p] = await pr.listProposals();
    const ap = await pr.approve({ shopee: c }, [p.id]);
    expect(ap.applied).toBe(1);
    expect(items["1"].name).toBe(GOOD);
    expect((await pr.listProposals({ status: "applied" }))[0].backup_id).toBeTruthy();

    const rv = await pr.revert({ shopee: c }, [p.id]);
    expect(rv.reverted).toBe(1);
    expect(items["1"].name).toContain("KEBAYA");
    expect(await pr.listProposals({ status: "reverted" })).toHaveLength(1);
  });
  it("produk berubah sejak usulan -> kedaluwarsa, tidak ditulis", async () => {
    const items = { "1": { name: "Kebaya Lama Wanita Modern Brokat Premium Set", desc: DESC } };
    const c = fake(items);
    const { created } = await pr.createProposals({ shopee: c }, "shopee", "9", "Delova Wardrobe", [{ item_id: 1, name: GOOD }]);
    items["1"].name = "Diubah orang lain di Seller Center Kebaya Premium";
    const r = await pr.approve({ shopee: c }, [created[0].id]);
    expect(r.results[0].status).toBe("stale");
    expect(c.calls).toHaveLength(0);
  });
  it("usulan baru menggantikan pending lama; tolak massal; kelompok per brand", async () => {
    const items = { "1": { name: "Kebaya Lama Wanita Modern Brokat Premium Set", desc: DESC } };
    const c = fake(items);
    await pr.createProposals({ shopee: c }, "shopee", "9", "Delova Kids", [{ item_id: 1, name: GOOD }]);
    await pr.createProposals({ shopee: c }, "shopee", "9", "Delova Kids", [{ item_id: 1, name: GOOD + " Terbaru" }]);
    const pend = await pr.listProposals();
    expect(pend).toHaveLength(1);
    expect(pr.groupByBrand(pend).map((g) => g.brand)).toEqual(["kids"]);
    expect((await pr.reject(pend.map((p) => p.id))).rejected).toBe(1);
  });
});
