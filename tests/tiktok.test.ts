import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, TikTokConfig } from "../src/lib/config";
import { overview } from "../src/lib/dashboard";
import * as q from "../src/lib/queue";
import { ShopeeClient, rateLimit } from "../src/lib/shopee";
import { KEYS, Store, getStore, setStoreForTests } from "../src/lib/store";
import { TikTokClient, makeSignTT, ttRateLimit } from "../src/lib/tiktok";
import * as promo from "../src/lib/tiktokPromo";
import * as seo from "../src/lib/seo";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  async hget<T>(h: string, f: string) { const v = this.d[h]?.[f]; return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T); }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hsetMany(h: string, e: Record<string, unknown>) { for (const [k, v] of Object.entries(e)) await this.hset(h, k, v); }
  async hgetall<T>(h: string) { return JSON.parse(JSON.stringify(this.d[h] ?? {})) as Record<string, T>; }
  async lock() { return true; }
  async unlock() {}
}

const SECRET = "app-secret-xyz";
const cfg: Config = { partnerId: 1, partnerKey: "k", env: "sandbox", host: "https://shopee.test", baseUrl: "https://app.test", readOnly: false, mcpSecret: "x".repeat(20) };
const tt: TikTokConfig = { appKey: "APPKEY", appSecret: SECRET, serviceId: "SVC", apiHost: "https://tt.test", authHost: "https://auth.tt.test" };
const now = () => Math.floor(Date.now() / 1000);
const BIG = ["7312345678901234567", "7312345678901234568", "7312345678901234569"]; // di atas 2^53
const ttitle = (n: string) => `Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Varian ${n}`;

type Call = { method: string; path: string; q: URLSearchParams; headers: Record<string, string>; body?: any };
let calls: Call[];
let products: Record<string, { title: string; description: string }>;
let hook: (c: Call) => Response | void;
let tokenGets: number;

const json = (o: unknown) => new Response(JSON.stringify(o));
const ok = (data: unknown) => json({ code: 0, message: "Success", data, request_id: "rid" });
const fail = (code: number, message: string) => json({ code, message, request_id: "rid" });

function mockTikTok() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
    const u = new URL(url);
    const c: Call = { method: init.method ?? "GET", path: u.pathname, q: u.searchParams, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const h = hook(c);
    if (h) return h;
    if (u.host === "auth.tt.test") {
      tokenGets++;
      if (u.pathname === "/api/v2/token/get") return ok({ access_token: "AT1", refresh_token: "RT1", access_token_expire_in: now() + 3600, refresh_token_expire_in: now() + 300 * 86400, open_id: "OPEN1", seller_name: "Delova" });
      if (u.pathname === "/api/v2/token/refresh") return ok({ access_token: "AT2", refresh_token: "RT2", access_token_expire_in: now() + 3600, refresh_token_expire_in: now() + 300 * 86400, open_id: "OPEN1" });
    }
    if (u.pathname === "/authorization/202309/shops") return ok({ shops: [{ id: "S1", cipher: "CIPH1", name: "Delova Wardrobe", region: "ID" }] });
    if (u.pathname === "/product/202309/products/search") return ok({ products: Object.entries(products).map(([id, p]) => ({ id, title: p.title, status: "ACTIVATE" })), total_count: 3 });
    const m = u.pathname.match(/^\/product\/202309\/products\/(\d+)(\/partial_edit)?$/);
    if (m) {
      const p = products[m[1]];
      if (!p) return fail(12052013, "product does not exist");
      if (m[2]) {
        if (c.body.title !== undefined) p.title = c.body.title;
        if (c.body.description !== undefined) p.description = c.body.description;
        return ok({});
      }
      return ok({ id: m[1], title: p.title, description: p.description, status: "ACTIVATE" });
    }
    return fail(99999, "unknown " + u.pathname);
  }));
}

const client = () => new TikTokClient(cfg, tt, getStore());

beforeEach(async () => {
  rateLimit.gapMs = 0;
  ttRateLimit.gapMs = 0;
  q.tuning.retrySleepMs = 0;
  q.tuning.batchErrorSleepMs = 0;
  calls = [];
  tokenGets = 0;
  hook = () => undefined;
  products = Object.fromEntries(BIG.map((id, i) => [id, { title: `Judul lama produk tiktok nomor ${i} abc`, description: `<p>desk ${i}</p>` }]));
  const s = new MemStore();
  await s.hset(KEYS.ttAuth, "OPEN1", { open_id: "OPEN1", access_token: "AT0", refresh_token: "RT0", expire_at: now() + 3600, refresh_expire_at: now() + 100 * 86400, connected_at: now() - 86400 });
  await s.hset(KEYS.ttShops, "S1", { shop_id: "S1", shop_cipher: "CIPH1", shop_name: "Delova Wardrobe", region: "ID", open_id: "OPEN1" });
  setStoreForTests(s);
  mockTikTok();
});

describe("signing", () => {
  it("urut abjad, tanpa sign/access_token, body ikut, dibungkus secret", () => {
    const sig = makeSignTT(SECRET, "/product/202309/products/1", { timestamp: 100, app_key: "K", sign: "x", access_token: "y", shop_cipher: "C" }, '{"a":1}');
    const plain = `${SECRET}/product/202309/products/1app_keyKshop_cipherCtimestamp100{"a":1}${SECRET}`;
    expect(sig).toBe(createHmac("sha256", SECRET).update(plain).digest("hex"));
  });
  it("tanpa body untuk GET dan nilai undefined diabaikan", () => {
    const sig = makeSignTT(SECRET, "/p", { b: "2", a: "1", z: undefined });
    expect(sig).toBe(createHmac("sha256", SECRET).update(`${SECRET}/pa1b2${SECRET}`).digest("hex"));
  });
});

describe("OAuth & request", () => {
  it("tukar code: simpan token (kedaluwarsa mutlak) dan toko, URL otorisasi", async () => {
    const c = client();
    expect(c.authUrl("st")).toBe("https://services.tiktokshop.com/open/authorize?service_id=SVC&state=st");
    const r = await c.exchangeCode("CODE");
    expect(r.shops.map((s) => [s.shop_id, s.shop_cipher])).toEqual([["S1", "CIPH1"]]);
    const a = await getStore().hget<any>(KEYS.ttAuth, "OPEN1");
    expect(a.refresh_expire_at).toBeGreaterThan(now() + 299 * 86400);
    const first = calls[0];
    expect(first.q.get("auth_code")).toBe("CODE");
    expect(first.q.get("grant_type")).toBe("authorized_code");
  });

  it("request memakai header token, shop_cipher, app_key dan sign yang benar", async () => {
    await client().call("GET", "/product/202309/products/" + BIG[0], { shopId: "S1" });
    const c = calls[0];
    expect(c.headers["x-tts-access-token"]).toBe("AT0");
    expect(c.q.get("shop_cipher")).toBe("CIPH1");
    expect(c.q.get("app_key")).toBe("APPKEY");
    const q2: Record<string, string> = {};
    c.q.forEach((v, k) => (q2[k] = v));
    expect(c.q.get("sign")).toBe(makeSignTT(SECRET, c.path, q2, ""));
  });

  it("token kedaluwarsa (105002) -> refresh sekali lalu ulangi", async () => {
    let n = 0;
    hook = (c) => {
      if (c.path.startsWith("/product/202309/products/") && n++ === 0) return fail(105002, "access token expired");
    };
    const p = await client().call("GET", "/product/202309/products/" + BIG[0], { shopId: "S1" });
    expect(p.title).toContain("Judul lama");
    expect(tokenGets).toBe(1);
    expect(calls.filter((c) => c.path.startsWith("/product")).at(-1)!.headers["x-tts-access-token"]).toBe("AT2");
    const a = await getStore().hget<any>(KEYS.ttAuth, "OPEN1");
    expect(a.refresh_token).toBe("RT2");
  });

  it("READ_ONLY memblokir tulis, GET tetap boleh", async () => {
    const ro = new TikTokClient({ ...cfg, readOnly: true }, tt, getStore());
    await expect(ro.call("POST", "/x", { shopId: "S1", body: {} })).rejects.toThrow(/READ_ONLY/);
    await expect(ro.call("GET", "/product/202309/products/" + BIG[0], { shopId: "S1" })).resolves.toBeTruthy();
  });

  it("resolveShop: otomatis bila satu toko, salah id ditolak", async () => {
    expect(await client().resolveShop()).toBe("S1");
    await expect(client().resolveShop("NOPE")).rejects.toThrow(/belum terhubung/);
  });
});

describe("antrian TikTok", () => {
  const changes = (ids: string[]) => ids.map((id) => ({ item_id: id, name: ttitle(id.slice(-3)) }));
  async function start(ids: string[]) {
    const e = await q.enqueue({ shopId: "S1", platform: "tiktok", changes: changes(ids) });
    await q.control(e.job_id, "start");
    return e.job_id;
  }
  const runAll = async () => { for (let i = 0; i < 10; i++) if (!(await q.runSlice(new ShopeeClient(cfg, getStore()), 30_000, client())).more) break; };

  it("id besar tetap utuh (string), judul 255 karakter dibolehkan, Shopee menolak >120", async () => {
    const long = "k".repeat(200);
    const e = await q.enqueue({ shopId: "S1", platform: "tiktok", changes: [{ item_id: BIG[0], name: long }] });
    expect(e.accepted).toBe(1);
    const sh = await q.enqueue({ shopId: 1, changes: [{ item_id: 5, name: long }] });
    expect(sh.rejected).toHaveLength(1);
    const job = await getStore().hget<any>(KEYS.items(e.job_id), BIG[0]);
    expect(job.item_id).toBe(BIG[0]);
  });

  it("memproses job, menyimpan nilai asli, lalu rollback memulihkan", async () => {
    const before = BIG.map((id) => products[id].title);
    const id = await start(BIG);
    await runAll();
    const st = await q.status(id);
    expect([st.status, st.done_ok, st.failed, st.platform]).toEqual(["completed", 3, 0, "tiktok"]);
    expect(BIG.map((b) => products[b].title)).toEqual(BIG.map((b) => ttitle(b.slice(-3))));
    expect(products[BIG[0]].description).toBe("<p>desk 0</p>"); // deskripsi tak diubah
    await q.control(id, "rollback");
    await runAll();
    expect(BIG.map((b) => products[b].title)).toEqual(before);
  });

  it("job TikTok tidak disentuh bila TikTok tidak dikonfigurasi (tidak looping)", async () => {
    const id = await start(BIG);
    const r = await q.runSlice(new ShopeeClient(cfg, getStore()), 30_000);
    expect(r.jobs).toEqual([]);
    expect(r.more).toBe(false);
    expect((await q.status(id)).pending).toBe(3);
  });

  it("produk tidak ada -> gagal dengan alasan; error izin -> job dijeda", async () => {
    const id = await start(["7312345678901234500", BIG[0]]);
    await runAll();
    const st = await q.status(id);
    expect([st.done_ok, st.failed]).toEqual([1, 1]);
    expect(st.failures_sample[0].item_id).toBe("7312345678901234500");

    products = Object.fromEntries(BIG.map((b) => [b, { title: "Judul lama yang cukup panjang untuk tes ya", description: "d" }]));
    hook = (c) => (c.path.endsWith("/partial_edit") ? fail(36009004, "permission denied: scope not authorized") : undefined);
    const id2 = await start([BIG[1]]);
    await runAll();
    const st2 = await q.status(id2);
    expect(st2.status).toBe("paused");
    expect(st2.pause_reason).toMatch(/otorisasi/);
  });

  it("error sementara (rate limit) dicoba ulang lalu berhasil", async () => {
    let n = 0;
    hook = (c) => (c.path.endsWith("/partial_edit") && n++ < 1 ? fail(36009999, "too many requests, rate limited") : undefined);
    const id = await start([BIG[2]]);
    await runAll();
    expect((await q.status(id)).done_ok).toBe(1);
  });
});

describe("promosi", () => {
  const t0 = now() + 3600;
  const base = { title: "Promo 11.11", activity_type: "DIRECT_DISCOUNT" as const, begin_time: t0, end_time: t0 + 86400, products: [{ id: BIG[0], discount_percent: 20 }] };

  it("validasi lokal", () => {
    expect(promo.validatePromo(base)).toEqual([]);
    expect(promo.validatePromo({ ...base, begin_time: now() - 5 }).join()).toMatch(/masa depan/);
    expect(promo.validatePromo({ ...base, end_time: t0 }).join()).toMatch(/setelah begin_time/);
    expect(promo.validatePromo({ ...base, title: "x".repeat(51) }).join()).toMatch(/maks 50/);
    expect(promo.validatePromo({ ...base, products: [{ id: BIG[0] }] }).join()).toMatch(/discount_percent wajib/);
    expect(promo.validatePromo({ ...base, activity_type: "FIXED_PRICE", products: [{ id: "1" }] }).join()).toMatch(/activity_price_amount wajib/);
    const flash = { ...base, activity_type: "FLASH_SALE" as const, products: [{ id: "1", activity_price_amount: 50000 }] };
    expect(promo.validatePromo(flash).join()).toMatch(/quantity_limit/);
    expect(promo.validatePromo({ ...base, products: [{ id: "1", discount_percent: 20 }, { id: "1", discount_percent: 10 }] }).join()).toMatch(/duplikat/);
  });

  it("buat promosi lalu tambah produk (body sesuai) dan deactivate/remove", async () => {
    hook = (c) => {
      if (c.method === "POST" && c.path === "/promotion/202309/activities") return ok({ activity_id: "ACT1" });
      if (c.path.startsWith("/promotion/202309/activities/ACT1")) return ok({});
    };
    const c = client();
    const created = await promo.createActivity(c, "S1", base);
    expect(created.activity_id).toBe("ACT1");
    expect(calls.at(-1)!.body).toMatchObject({ title: "Promo 11.11", activity_type: "DIRECT_DISCOUNT", product_level: "PRODUCT" });
    await promo.addProducts(c, "S1", "ACT1", [{ id: BIG[0], discount_percent: 20 }, { id: "9", activity_price_amount: 75000, quantity_limit: 5, quantity_per_user: 1 }]);
    expect(calls.at(-1)!.body.products).toEqual([
      { id: BIG[0], discount: "20" },
      { id: "9", activity_price_amount: "75000", quantity_limit: 5, quantity_per_user: 1 },
    ]);
    await promo.removeProducts(c, "S1", "ACT1", [BIG[0]]);
    expect([calls.at(-1)!.method, calls.at(-1)!.body]).toEqual(["DELETE", { product_ids: [BIG[0]] }]);
    await promo.deactivate(c, "S1", "ACT1");
    expect(calls.at(-1)!.path).toBe("/promotion/202309/activities/ACT1/deactivate");
  });
});

describe("SEO & dashboard", () => {
  it("batas TikTok vs Shopee", () => {
    expect(seo.validateTitle("k".repeat(200), seo.TIKTOK_LIMITS).join()).not.toMatch(/terlalu panjang/);
    expect(seo.validateTitle("k".repeat(200)).join()).toMatch(/terlalu panjang/);
    expect(seo.blockingErrors("k".repeat(300), undefined, seo.TIKTOK_LIMITS)).toHaveLength(1);
  });

  it("dashboard menampilkan toko TikTok tanpa token, tanggal resmi, dan job bernama toko", async () => {
    const id = (await q.enqueue({ shopId: "S1", platform: "tiktok", changes: [{ item_id: BIG[0], name: ttitle("x") }], label: "SEO TikTok" })).job_id;
    process.env.TIKTOK_APP_KEY = "k"; process.env.TIKTOK_APP_SECRET = "s";
    const o = await overview(cfg);
    delete process.env.TIKTOK_APP_KEY; delete process.env.TIKTOK_APP_SECRET;
    const s = o.shops.find((x) => x.platform === "tiktok")!;
    expect([s.shop_id, s.shop_name, s.health, s.estimated, s.region]).toEqual(["S1", "Delova Wardrobe", "active", false, "ID"]);
    expect(JSON.stringify(o)).not.toMatch(/AT0|RT0/);
    expect(o.server.tiktok_configured).toBe(true);
    const j = o.jobs.find((x) => x.job_id === id)!;
    expect([j.platform, j.shop_name, j.per_minute]).toEqual(["tiktok", "Delova Wardrobe", 35]);
  });
});
