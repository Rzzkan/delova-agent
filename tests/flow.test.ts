import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/lib/config";
import { applyChanges, listBackups, rollback } from "../src/lib/bulk";
import { ShopeeClient } from "../src/lib/shopee";
import { KEYS, Store, getStore, setStoreForTests } from "../src/lib/store";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  async hget<T>(h: string, f: string) { return (this.d[h]?.[f] as T) ?? null; }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hgetall<T>(h: string) { return (this.d[h] ?? {}) as Record<string, T>; }
  async lock() { return true; }
  async unlock() {}
}

const cfg: Config = {
  partnerId: 1, partnerKey: "k", env: "sandbox", host: "https://shopee.test",
  baseUrl: "https://app.test", readOnly: false, mcpSecret: "x".repeat(20),
};
const LONG = "Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Kondangan Wisuda";
const OLD1 = "Nama lama produk satu abc";

let calls: { path: string; method: string; body: any; q: URLSearchParams }[];
let names: Record<number, string>;

function mockShopee(opts: { failUpdateFor?: number } = {}) {
  let refreshed = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, method: init.method, body, q: u.searchParams });
    const json = (o: any) => new Response(JSON.stringify(o));
    switch (u.pathname) {
      case "/api/v2/auth/access_token/get":
        refreshed++;
        return json({ access_token: "tok-new", refresh_token: "ref-new", expire_in: 14400 });
      case "/api/v2/product/get_item_base_info":
        return json({
          response: {
            item_list: u.searchParams.get("item_id_list")!.split(",").map((id) => ({
              item_id: Number(id), item_name: names[Number(id)],
              description: "deskripsi lama " + id, description_type: "normal",
            })),
          },
        });
      case "/api/v2/product/update_item":
        if (body.item_id === opts.failUpdateFor) return json({ error: "error_param", message: "boom", request_id: "r1" });
        names[body.item_id] = body.item_name ?? names[body.item_id];
        return json({ error: "", response: {} });
    }
    return json({ error: "error_not_found", message: u.pathname });
  }));
  return { refreshed: () => refreshed };
}

beforeEach(async () => {
  calls = [];
  names = { 1: OLD1, 2: "Nama lama produk dua abc" };
  const store = new MemStore();
  await store.hset(KEYS.tokens, "99", {
    shop_id: 99, access_token: "tok-old", refresh_token: "ref-old", expire_at: Math.floor(Date.now() / 1000) + 3600,
  });
  setStoreForTests(store);
});

const client = (over: Partial<Config> = {}) => new ShopeeClient({ ...cfg, ...over }, getStore());

describe("bulk flow", () => {
  it("dry-run tidak menulis apa pun", async () => {
    mockShopee();
    const r: any = await applyChanges(client(), 99, [{ item_id: 1, name: LONG }], true);
    expect(r.dry_run).toBe(true);
    expect(calls.some((x) => x.path.endsWith("update_item"))).toBe(false);
    expect(r.rows[0].status).toBe("ok");
  });

  it("apply -> backup -> rollback", async () => {
    mockShopee();
    const c = client();
    const r: any = await applyChanges(c, 99, [{ item_id: 1, name: LONG }, { item_id: 2, name: "pendek" }], false);
    expect(r.results).toEqual([
      { item_id: 1, result: "berhasil" },
      { item_id: 2, result: "dilewati (tidak valid)" },
    ]);
    expect(names[1]).toBe(LONG);
    expect((await listBackups())[0].backup_id).toBe(r.backup_id);
    const rb: any = await rollback(c, r.backup_id);
    expect(names[1]).toBe(OLD1);
    expect(rb.restored).toBe(2);
  });

  it("kegagalan satu item tidak menghentikan batch", async () => {
    mockShopee({ failUpdateFor: 1 });
    const r: any = await applyChanges(client(), 99, [{ item_id: 1, name: LONG }, { item_id: 2, name: LONG + " 2" }], false);
    expect(r.results[0].result).toMatch(/^gagal: error_param/);
    expect(r.results[1].result).toBe("berhasil");
  });

  it("menolak batch lebih dari batas", async () => {
    mockShopee();
    const many = Array.from({ length: 41 }, (_, i) => ({ item_id: i + 1, name: LONG }));
    await expect(applyChanges(client(), 99, many, false)).rejects.toThrow(/Maks 40/);
  });

  it("read-only memblokir penulisan", async () => {
    mockShopee();
    const r: any = await applyChanges(client({ readOnly: true }), 99, [{ item_id: 1, name: LONG }], false);
    expect(r.results[0].result).toMatch(/READ_ONLY/);
    expect(names[1]).toBe(OLD1);
  });

  it("token kedaluwarsa di-refresh dan refresh_token baru disimpan", async () => {
    const m = mockShopee();
    const store = getStore();
    await store.hset(KEYS.tokens, "99", { shop_id: 99, access_token: "tok-old", refresh_token: "ref-old", expire_at: 1 });
    await applyChanges(client(), 99, [{ item_id: 1, name: LONG }], true);
    expect(m.refreshed()).toBe(1);
    const saved: any = await store.hget(KEYS.tokens, "99");
    expect(saved.refresh_token).toBe("ref-new");
    const used = calls.find((x) => x.path.endsWith("get_item_base_info"))!;
    expect(used.q.get("access_token")).toBe("tok-new");
  });

  it("resolveShop: satu toko otomatis, banyak toko wajib dipilih", async () => {
    const store = getStore();
    const c = client();
    expect(await c.resolveShop()).toBe(99);
    await store.hset(KEYS.tokens, "100", { shop_id: 100, access_token: "a", refresh_token: "b", expire_at: 9e12 });
    await expect(c.resolveShop()).rejects.toThrow(/beberapa toko/);
    expect(await c.resolveShop(100)).toBe(100);
    await expect(c.resolveShop(5)).rejects.toThrow(/belum terhubung/);
  });
});
