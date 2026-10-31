import { beforeEach, describe, expect, it } from "vitest";
import * as pa from "../src/lib/productAdmin";
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

const OLD = "Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta";
const NEW = "Kebaya Brokat Modern Wanita Premium Set Rok Batik Lilit Baju Pesta Kondangan";
const DESC = "Kebaya brokat modern dengan bahan premium nyaman dipakai seharian. ".repeat(3);

function shopeeFake() {
  const calls: { path: string; body?: any }[] = [];
  const item = { item_id: 77, item_name: OLD, item_status: "NORMAL", description_type: "normal", description: DESC };
  const c: any = {
    calls,
    async get(_s: number, path: string, params: any) {
      calls.push({ path, body: params });
      if (path.endsWith("get_item_list")) return { response: { item: [{ item_id: 77 }], has_next_page: false, total_count: 1 } };
      if (path.endsWith("search_item")) return { response: { item_id_list: [77], total_count: 1 } };
      return { response: { item_list: [{ ...item }] } };
    },
    async post(_s: number, path: string, body: any) {
      calls.push({ path, body });
      if (path.endsWith("update_item")) { if (body.item_name) item.item_name = body.item_name; if (body.description) item.description = body.description; }
      return { response: {} };
    },
  };
  return { c, item };
}

beforeEach(() => setStoreForTests(new MemStore()));

describe("produk Shopee", () => {
  it("daftar, detail", async () => {
    const { c } = shopeeFake();
    const l = await pa.listProducts({ shopee: c }, "shopee", "1");
    expect(l.items[0]).toMatchObject({ id: "77", name: OLD, status: "NORMAL" });
    expect(typeof l.items[0].title_score).toBe("number");
    const s = await pa.listProducts({ shopee: c }, "shopee", "1", { q: "kebaya" });
    expect(c.calls.some((x: any) => x.path.endsWith("search_item"))).toBe(true);
    expect(s.items).toHaveLength(1);
    const d = await pa.getDetail({ shopee: c }, "shopee", "1", "77");
    expect(d.limits.titleMax).toBe(120);
  });
  it("edit membuat backup lalu bisa dipulihkan", async () => {
    const { c, item } = shopeeFake();
    const r = await pa.editProduct({ shopee: c }, "shopee", "1", "77", { name: NEW });
    expect(item.item_name).toBe(NEW);
    const log = await pa.listLog("shopee", "1", "77");
    expect(log[0].name).toBe(OLD);
    await pa.restore({ shopee: c }, r.backup_id);
    expect(item.item_name).toBe(OLD);
  });
  it("edit tidak valid ditolak sebelum menulis", async () => {
    const { c } = shopeeFake();
    await expect(pa.editProduct({ shopee: c }, "shopee", "1", "77", { name: "pendek" })).rejects.toThrow(/ditolak/);
    expect(c.calls.some((x: any) => x.path.endsWith("update_item"))).toBe(false);
    expect(await pa.listLog("shopee", "1")).toHaveLength(0);
  });
});

describe("produk TikTok", () => {
  function ttFake() {
    const calls: { m: string; path: string; body?: any }[] = [];
    const p = { id: "1729999999999999999", title: OLD, status: "ACTIVATE", description: `<p>${DESC}</p>` };
    const c: any = {
      calls,
      async call(m: string, path: string, o: any) {
        calls.push({ m, path, body: o?.body });
        if (path.endsWith("/search")) return { products: [{ id: p.id, title: p.title, status: p.status }], total_count: 1 };
        if (path.endsWith("partial_edit")) { if (o.body.title) p.title = o.body.title; if (o.body.description) p.description = o.body.description; return {}; }
        if (m === "DELETE") return {};
        return { ...p };
      },
    };
    return { c, p };
  }
  it("ID tetap string, edit + pulihkan", async () => {
    const { c, p } = ttFake();
    const l = await pa.listProducts({ tiktok: c }, "tiktok", "S1");
    expect(l.items[0].id).toBe("1729999999999999999");
    const r = await pa.editProduct({ tiktok: c }, "tiktok", "S1", p.id, { name: NEW });
    expect(p.title).toBe(NEW);
    await pa.restore({ tiktok: c }, r.backup_id);
    expect(p.title).toBe(OLD);
  });
  it("deskripsi HTML dihitung tanpa tag", () => {
    const e = pa.checkEdit("tiktok", { description: "<p>pendek</p>" });
    expect(e.errors.join()).toMatch(/minimal/);
  });
});
