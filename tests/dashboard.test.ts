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
