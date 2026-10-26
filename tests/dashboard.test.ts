import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/lib/config";
import { COOKIE, isAuthed, isJsonRequest, overview, readCookie, runAction, sessionToken, shopHealth } from "../src/lib/dashboard";
import * as q from "../src/lib/queue";
import { KEYS, Store, getStore, setStoreForTests } from "../src/lib/store";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  async hget<T>(h: string, f: string) { const v = this.d[h]?.[f]; return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T); }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hsetMany(h: string, e: Record<string, unknown>) { for (const [k, v] of Object.entries(e)) await this.hset(h, k, v); }
  async hgetall<T>(h: string) { return JSON.parse(JSON.stringify(this.d[h] ?? {})) as Record<string, T>; }
  async lock() { return true; }
  async unlock() {}
}

const SECRET = "dashboard-secret-0123456789";
const cfg: Config = {
  partnerId: 1, partnerKey: "k", env: "sandbox", host: "https://shopee.test",
  baseUrl: "https://app.test", readOnly: false, mcpSecret: SECRET,
};
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const req = (headers: Record<string, string> = {}, url = "https://app.test/api/dashboard/data") => new Request(url, { headers });
const title = (n: number) => `Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Varian ${n}`;

beforeEach(async () => {
  const s = new MemStore();
  await s.hset(KEYS.tokens, "1", { shop_id: 1, shop_name: "Delova Wardrobe", access_token: "SECRET-ACCESS-1", refresh_token: "SECRET-REFRESH-1", expire_at: now() + 3600, refresh_expire_at: now() + 27 * DAY, connected_at: now() - 3 * DAY });
  await s.hset(KEYS.tokens, "2", { shop_id: 2, shop_name: "Delova Kids", access_token: "SECRET-ACCESS-2", refresh_token: "SECRET-REFRESH-2", expire_at: now() + 3600, refresh_expire_at: now() + 2 * DAY });
  await s.hset(KEYS.tokens, "3", { shop_id: 3, access_token: "SECRET-ACCESS-3", refresh_token: "SECRET-REFRESH-3", expire_at: 1 }); // record lama tanpa tanggal
  setStoreForTests(s);
});

describe("kesehatan toko", () => {
  it("active / expiring / expired / unknown", () => {
    const n = 1_000_000;
    expect(shopHealth(n + 20 * DAY, n)).toBe("active");
    expect(shopHealth(n + 4 * DAY, n)).toBe("expiring");
    expect(shopHealth(n - 1, n)).toBe("expired");
    expect(shopHealth(undefined, n)).toBe("unknown");
  });
});

describe("autentikasi dashboard", () => {
  it("cookie sesi valid diterima, salah ditolak, tanpa apa pun ditolak", () => {
    expect(isAuthed(req({ cookie: `${COOKIE}=${sessionToken(SECRET)}` }), SECRET)).toBe(true);
    expect(isAuthed(req({ cookie: `a=b; ${COOKIE}=${sessionToken(SECRET)}; c=d` }), SECRET)).toBe(true);
    expect(isAuthed(req({ cookie: `${COOKIE}=salah` }), SECRET)).toBe(false);
    expect(isAuthed(req(), SECRET)).toBe(false);
  });
  it("Bearer dan ?key= tetap diterima; secret lemah selalu ditolak", () => {
    expect(isAuthed(req({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
    expect(isAuthed(req({}, `https://app.test/x?key=${SECRET}`), SECRET)).toBe(true);
    expect(isAuthed(req({ cookie: `${COOKIE}=${sessionToken("pendek")}` }), "pendek")).toBe(false);
  });
  it("mengganti MCP_SECRET mencabut sesi lama", () => {
    const old = sessionToken(SECRET);
    expect(isAuthed(req({ cookie: `${COOKIE}=${old}` }), SECRET + "baru")).toBe(false);
  });
  it("readCookie & CSRF (wajib JSON)", () => {
    expect(readCookie(req({ cookie: "x=1; y=a%20b" }), "y")).toBe("a b");
    expect(isJsonRequest(new Request("https://a", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" } }))).toBe(true);
    expect(isJsonRequest(new Request("https://a", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }))).toBe(false);
    expect(isJsonRequest(new Request("https://a", { method: "POST" }))).toBe(false);
  });
});

describe("overview", () => {
  it("tidak pernah membocorkan token", async () => {
    const o = await overview(cfg);
    const json = JSON.stringify(o);
    expect(json).not.toMatch(/SECRET-ACCESS|SECRET-REFRESH|access_token|refresh_token/);
    expect(json).not.toContain(SECRET);
  });
  it("daftar toko, hari tersisa, dan status", async () => {
    const o = await overview(cfg);
    const [a, b, c] = o.shops;
    expect([a.shop_id, a.health, a.days_left]).toEqual(["1", "active", 26]);
    expect([b.shop_id, b.health]).toEqual(["2", "expiring"]);
    expect([c.shop_id, c.health, c.refresh_expire_at]).toEqual(["3", "unknown", null]);
    expect(o.server).toMatchObject({ env: "sandbox", read_only: false });
  });
  it("ringkasan antrian + nama toko di tiap job", async () => {
    const e = await q.enqueue({ shopId: 1, label: "SEO kebaya", changes: [1, 2, 3, 4].map((i) => ({ item_id: i, name: title(i) })) });
    await q.enqueue({ shopId: 2, label: "draft saja", changes: [{ item_id: 9, name: title(9) }] });
    await q.control(e.job_id, "start");
    const o = await overview(cfg);
    expect(o.summary).toMatchObject({ active_jobs: 1, pending_items: 4, failed_items: 0 });
    const job = o.jobs.find((j) => j.job_id === e.job_id)!;
    expect(job).toMatchObject({ shop_name: "Delova Wardrobe", total: 4, status: "queued" });
    expect(o.jobs.find((j) => j.label === "draft saja")).toMatchObject({ status: "draft", shop_name: "Delova Kids" });
  });
  it("alasan jeda ikut tampil", async () => {
    const e = await q.enqueue({ shopId: 1, changes: [{ item_id: 1, name: title(1) }] });
    await q.control(e.job_id, "start");
    await q.control(e.job_id, "pause");
    const o = await overview(cfg);
    expect(o.jobs[0]).toMatchObject({ status: "paused", pause_reason: "dijeda manual" });
  });
});

describe("aksi dashboard", () => {
  it("start / pause / resume / cancel lewat runAction", async () => {
    const e = await q.enqueue({ shopId: 1, changes: [{ item_id: 1, name: title(1) }] });
    expect(await runAction(cfg, e.job_id, "start")).toMatchObject({ status: "queued" });
    expect(await runAction(cfg, e.job_id, "pause")).toMatchObject({ status: "paused" });
    expect(await runAction(cfg, e.job_id, "resume")).toMatchObject({ status: "queued" });
    expect(await runAction(cfg, e.job_id, "cancel")).toMatchObject({ status: "cancelled" });
  });
  it("job_id wajib dan job tak dikenal ditolak", async () => {
    await expect(runAction(cfg, undefined, "pause")).rejects.toThrow(/job_id/);
    await expect(runAction(cfg, "tidak-ada", "pause")).rejects.toThrow(/tidak ditemukan/);
  });
  it("store aktif tetap yang diinjeksi", () => {
    expect(getStore()).toBeInstanceOf(MemStore);
  });
});

describe("password dashboard", () => {
  const OLD = process.env.DASHBOARD_PASSWORD;
  afterEach(() => {
    if (OLD === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = OLD;
  });
  it("tanpa DASHBOARD_PASSWORD, login memakai MCP_SECRET", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const { loginCredential } = await import("../src/lib/dashboard");
    expect(loginCredential(SECRET)).toBe(SECRET);
  });
  it("dengan password: dipakai untuk login dan sesi berubah bila password diganti", async () => {
    const { loginCredential } = await import("../src/lib/dashboard");
    process.env.DASHBOARD_PASSWORD = "rahasia-dashboard";
    expect(loginCredential(SECRET)).toBe("rahasia-dashboard");
    const t1 = sessionToken(SECRET);
    expect(isAuthed(req({ cookie: `${COOKIE}=${t1}` }), SECRET)).toBe(true);
    process.env.DASHBOARD_PASSWORD = "password-baru-1";
    expect(isAuthed(req({ cookie: `${COOKIE}=${t1}` }), SECRET)).toBe(false);
  });
  it("password < 8 karakter diabaikan", async () => {
    const { loginCredential } = await import("../src/lib/dashboard");
    process.env.DASHBOARD_PASSWORD = "pendek";
    expect(loginCredential(SECRET)).toBe(SECRET);
  });
});

describe("flash sale mendatang", () => {
  it("parsing Shopee & TikTok toleran terhadap field kosong", async () => {
    const { parseShopeeSales, parseTikTokActivities, sortEntries } = await import("../src/lib/promos");
    const s = parseShopeeSales({ flash_sale_list: [{ flash_sale_id: 7, start_time: 2000, end_time: 3000, enabled_item_count: 4 }, {}] }, "upcoming");
    expect(s[0]).toMatchObject({ id: "7", start: 2000, end: 3000, product_count: 4, status: "upcoming" });
    expect(s[1].start).toBeNull();
    expect(parseShopeeSales(undefined, "upcoming")).toEqual([]);
    const t = parseTikTokActivities({ activities: [{ id: "99999999999999999", title: "Harbolnas", begin_time: "5000", end_time: 6000 }] }, "ongoing");
    expect(t[0]).toMatchObject({ id: "99999999999999999", title: "Harbolnas", start: 5000, end: 6000 });
    const mixed = sortEntries([{ ...s[0], start: 9 }, { ...t[0], start: 99 }, { ...s[0], start: 1 }]);
    expect(mixed[0].status).toBe("ongoing");
    expect(mixed[1].start).toBe(1);
  });
});

describe("upcomingPromos (Shopee, fetch dipalsukan)", () => {
  it("menggabungkan akan datang + berlangsung per toko, error satu toko terisolasi", async () => {
    const { upcomingPromos } = await import("../src/lib/promos");
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const u = new URL(String(input));
      const shop = u.searchParams.get("shop_id");
      const type = u.searchParams.get("timeslot_type");
      if (!u.pathname.endsWith("get_shop_flash_sale_list")) return new Response("{}", { status: 404 });
      if (shop === "2") return Response.json({ error: "error_auth", message: "no permission" });
      const list = type === "1" ? [{ flash_sale_id: 11, start_time: now() + 3600, end_time: now() + 7200, enabled_item_count: 3 }] : [{ flash_sale_id: 10, start_time: now() - 60, end_time: now() + 600, item_count: 5 }];
      return Response.json({ error: "", response: { flash_sale_list: list } });
    }) as typeof fetch;
    try {
      const r = await upcomingPromos(cfg);
      const s1 = r.shops.find((s) => s.shop_id === "1")!;
      expect(s1.entries.map((e) => [e.id, e.status])).toEqual([["10", "ongoing"], ["11", "upcoming"]]);
      expect(r.shops.find((s) => s.shop_id === "2")!.error).toBeTruthy();
      expect(JSON.stringify(r)).not.toMatch(/SECRET-ACCESS|SECRET-REFRESH/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("voucher aktif (Shopee, fetch dipalsukan)", () => {
  it("parsing nominal/persen, urut berakhir terdekat, error terisolasi", async () => {
    const { activeVouchers, parseShopeeVouchers } = await import("../src/lib/vouchers");
    const p = parseShopeeVouchers({ voucher_list: [{ voucher_id: 5, voucher_code: "HEMAT10", voucher_name: "Hemat", voucher_type: 1, reward_type: 2, percentage: 10, min_basket_price: 100000, usage_quantity: 50, current_usage: 7, start_time: 100, end_time: 900 }, { voucher_id: 6, reward_type: 1, discount_amount: 15000, end_time: 500 }] });
    expect(p[0]).toMatchObject({ id: "5", code: "HEMAT10", scope: "toko", reward: "persen", amount: 10, quota: 50, used: 7 });
    expect(p[1]).toMatchObject({ reward: "nominal", amount: 15000 });
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const u = new URL(String(input));
      if (u.searchParams.get("shop_id") === "2") return Response.json({ error: "error_auth", message: "no permission" });
      if (!u.pathname.endsWith("get_voucher_list") || u.searchParams.get("status") !== "ongoing") return new Response("{}", { status: 404 });
      return Response.json({ error: "", response: { more: false, voucher_list: [{ voucher_id: 1, end_time: now() + 9000 }, { voucher_id: 2, end_time: now() + 100 }] } });
    }) as typeof fetch;
    try {
      const r = await activeVouchers(cfg);
      expect(r.shops.find((s) => s.shop_id === "1")!.vouchers.map((v) => v.id)).toEqual(["2", "1"]);
      expect(r.shops.find((s) => s.shop_id === "2")!.error).toBeTruthy();
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("ringkasan per toko", () => {
  it("hitungan flash sale dan voucher dihitung per toko, tidak tercampur", async () => {
    const { summarizePromos, summarizeVouchers } = await import("../src/lib/summary");
    const a = summarizePromos([{ status: "upcoming" }, { status: "upcoming" }, { status: "ongoing" }]);
    const b = summarizePromos([{ status: "upcoming" }]);
    expect(a).toEqual({ upcoming: 2, ongoing: 1, total: 3 });
    expect(b).toEqual({ upcoming: 1, ongoing: 0, total: 1 });
    const n = 1_000_000;
    expect(summarizeVouchers([{ end: n + 3600 }, { end: n + 10 * 86400 }, { end: null }], n)).toEqual({ active: 3, expiring: 1 });
    expect(summarizeVouchers([], n)).toEqual({ active: 0, expiring: 0 });
  });
});

describe("kalender flash sale", () => {
  it("tanggal WIB, rentang multi-hari, dan tengah malam", async () => {
    const { dayKey, daysCovered, scheduleByDay, monthCells, monthStats } = await import("../src/lib/calendar");
    const t = Date.UTC(2026, 10, 11, 17, 30) / 1000; // 11 Nov 17:30 UTC = 12 Nov 00:30 WIB
    expect(dayKey(t)).toBe("2026-11-12");
    expect(daysCovered(t, t + 3600)).toEqual(["2026-11-12"]);
    const midnight = Date.UTC(2026, 10, 12, 17, 0) / 1000; // 13 Nov 00:00 WIB
    expect(daysCovered(t, midnight)).toEqual(["2026-11-12"]); // berakhir tepat 00:00 tidak masuk hari berikut
    expect(daysCovered(t, midnight + 86400)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(daysCovered(null, 5)).toEqual([]);
    const map = scheduleByDay([{ start: t, end: t + 3600 }, { start: t + 60, end: t + 7200 }]);
    expect(map.get("2026-11-12")).toHaveLength(2);
    const cells = monthCells(2026, 10); // Nov 2026 mulai Minggu -> 6 sel awal Okt
    expect(cells.length % 7).toBe(0);
    expect(cells[0].key).toBe("2026-10-26");
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(monthStats(map, 2026, 10, "2026-11-10")).toEqual({ scheduled: 1, free: 20 });
    expect(monthStats(map, 2026, 10, "2026-11-13")).toEqual({ scheduled: 0, free: 18 });
  });
});
