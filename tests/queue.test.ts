import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/lib/config";
import * as q from "../src/lib/queue";
import { ShopeeClient, rateLimit } from "../src/lib/shopee";
import { KEYS, Store, getStore, setStoreForTests } from "../src/lib/store";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  locks = new Set<string>();
  async hget<T>(h: string, f: string) { const v = this.d[h]?.[f]; return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T); }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hsetMany(h: string, e: Record<string, unknown>) { for (const [k, v] of Object.entries(e)) await this.hset(h, k, v); }
  async hgetall<T>(h: string) { return JSON.parse(JSON.stringify(this.d[h] ?? {})) as Record<string, T>; }
  async lock(k: string) { if (this.locks.has(k)) return false; this.locks.add(k); return true; }
  async unlock(k: string) { this.locks.delete(k); }
}

const cfg: Config = {
  partnerId: 1, partnerKey: "k", env: "sandbox", host: "https://shopee.test",
  baseUrl: "https://app.test", readOnly: false, mcpSecret: "x".repeat(20),
};
const title = (n: number) => `Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Varian ${n}`;

let names: Record<number, string>;
let hook: (itemId: number) => Response | void;
let updates: number[];

function mockShopee() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const json = (o: any) => new Response(JSON.stringify(o));
    if (u.pathname === "/api/v2/product/get_item_base_info") {
      return json({ response: { item_list: u.searchParams.get("item_id_list")!.split(",").filter((id) => names[Number(id)] !== undefined).map((id) => ({
        item_id: Number(id), item_name: names[Number(id)], description: "desk " + id, description_type: "normal" })) } });
    }
    if (u.pathname === "/api/v2/product/update_item") {
      const r = hook(body.item_id);
      if (r) return r;
      updates.push(body.item_id);
      if (body.item_name !== undefined) names[body.item_id] = body.item_name;
      return json({ error: "", response: {} });
    }
    if (u.pathname === "/api/v2/auth/access_token/get") {
      return json({ access_token: "t2", refresh_token: "r2", expire_in: 14400 });
    }
    return json({ error: "error_not_found", message: u.pathname });
  }));
}

const err = (error: string) => new Response(JSON.stringify({ error, message: "x", request_id: "r" }));
const client = () => new ShopeeClient(cfg, getStore());
const changes = (ids: number[]) => ids.map((id) => ({ item_id: id, name: title(id) }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

async function startJob(ids: number[]) {
  const e = await q.enqueue({ shopId: 99, changes: changes(ids) });
  await q.control(e.job_id, "start");
  return e.job_id;
}

beforeEach(async () => {
  rateLimit.gapMs = 0;
  q.tuning.retrySleepMs = 0;
  q.tuning.batchErrorSleepMs = 0;
  names = Object.fromEntries(range(1, 60).map((i) => [i, `Nama lama produk nomor ${i} abc`]));
  hook = () => undefined;
  updates = [];
  const store = new MemStore();
  await store.hset(KEYS.tokens, "99", { shop_id: 99, access_token: "t", refresh_token: "r", expire_at: 9e12 });
  setStoreForTests(store);
  mockShopee();
});

describe("enqueue", () => {
  it("menolak yang melanggar aturan, dedup, boleh menambah saat draft", async () => {
    const a = await q.enqueue({
      shopId: 99,
      changes: [{ item_id: 1, name: "pendek" }, { item_id: 2, name: title(2) }, { item_id: 2, name: title(2) + " v2" }, { item_id: 3 }],
    });
    expect(a.accepted).toBe(1); // item 2 (versi terakhir menang)
    expect(a.rejected.map((r) => r.item_id).sort()).toEqual([1, 3]);
    const b = await q.enqueue({ shopId: 99, jobId: a.job_id, changes: changes([2, 4, 5]) });
    expect(b.total_in_job).toBe(3); // 2 tidak ganda
    const st = await q.status(a.job_id);
    expect(st.status).toBe("draft");
    expect(st.pending).toBe(3);
  });

  it("tidak bisa menambah setelah start", async () => {
    const id = await startJob([1]);
    await expect(q.enqueue({ shopId: 99, jobId: id, changes: changes([2]) })).rejects.toThrow(/draft/);
  });

  it("draft tidak diproses worker", async () => {
    await q.enqueue({ shopId: 99, changes: changes([1, 2]) });
    const r = await q.runSlice(client());
    expect(r.processed).toBe(0);
    expect(updates).toEqual([]);
  });
});

describe("worker", () => {
  it("memproses semua dan menandai selesai", async () => {
    const id = await startJob(range(1, 45));
    const r = await q.runSlice(client());
    expect(r.ok).toBe(45);
    expect(r.more).toBe(false);
    const st = await q.status(id);
    expect(st.status).toBe("completed");
    expect(st.done_ok).toBe(45);
    expect(names[7]).toBe(title(7));
  });

  it("slice habis waktu -> sisanya tetap menunggu dan dilanjutkan di slice berikutnya", async () => {
    const id = await startJob(range(1, 10));
    let n = 0;
    hook = () => { if (++n === 4) vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000); };
    const r1 = await q.runSlice(client(), 1000);
    vi.restoreAllMocks();
    expect(r1.processed).toBeLessThan(10);
    expect(r1.more).toBe(true);
    const mid = await q.status(id);
    expect(mid.pending + mid.done_ok).toBe(10);
    const r2 = await q.runSlice(client());
    expect(r2.more).toBe(false);
    expect((await q.status(id)).status).toBe("completed");
    expect(new Set(updates).size).toBe(10); // tak ada yang diproses dua kali
  });

  it("produk tanpa perubahan dilewati tanpa panggilan update", async () => {
    names[1] = title(1);
    const id = await startJob([1, 2]);
    await q.runSlice(client());
    expect(updates).toEqual([2]);
    expect((await q.status(id)).done_ok).toBe(2);
  });

  it("error sementara dicoba ulang; berhasil pada percobaan ke-3", async () => {
    let tries = 0;
    hook = (id) => (id === 2 && ++tries < 3 ? err("error_server") : undefined);
    const id = await startJob([1, 2, 3]);
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.status).toBe("completed");
    expect(tries).toBe(3);
  });

  it("error sementara terus-menerus -> gagal setelah 3 percobaan, yang lain tetap jalan", async () => {
    hook = (id) => (id === 2 ? err("error_busy") : undefined);
    const id = await startJob([1, 2, 3]);
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.status).toBe("completed_with_errors");
    expect(st.failed).toBe(1);
    expect(st.failures_sample[0]).toMatchObject({ item_id: 2, attempts: 3 });
    expect(st.done_ok).toBe(2);
  });

  it("error permanen langsung gagal; retry_failed memprosesnya lagi", async () => {
    let broken = true;
    hook = (id) => (id === 2 && broken ? err("error_param") : undefined);
    const id = await startJob([1, 2, 3]);
    await q.runSlice(client());
    expect((await q.status(id)).failed).toBe(1);
    broken = false;
    await q.control(id, "retry_failed");
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.status).toBe("completed");
    expect(st.failed).toBe(0);
    expect(names[2]).toBe(title(2));
  });

  it("produk tidak ada di toko -> gagal dengan pesan jelas", async () => {
    const id = await startJob([1, 9999]);
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.failures_sample[0]).toMatchObject({ item_id: 9999, error: "produk tidak ditemukan di toko" });
  });

  it("circuit breaker: 5 gagal berturut-turut -> job dijeda", async () => {
    hook = () => err("error_param");
    const id = await startJob(range(1, 8));
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.status).toBe("paused");
    expect(st.pause_reason).toMatch(/berturut-turut/);
    expect(st.pending).toBe(3);
  });

  it("error otorisasi -> job dijeda, produk tidak hilang dari antrian", async () => {
    hook = () => err("error_auth");
    const id = await startJob(range(1, 5));
    await q.runSlice(client());
    const st = await q.status(id);
    expect(st.status).toBe("paused");
    expect(st.pause_reason).toMatch(/otorisasi/);
    expect(st.pending).toBe(5);
    expect(st.failed).toBe(0);
    hook = () => undefined;
    await q.control(id, "resume");
    await q.runSlice(client());
    expect((await q.status(id)).status).toBe("completed");
  });

  it("pause saat berjalan dihormati dan tidak tertimpa worker", async () => {
    const id = await startJob(range(1, 10));
    let n = 0;
    hook = () => { if (++n === 3) void q.control(id, "pause"); };
    await q.runSlice(client());
    await new Promise((r) => setTimeout(r, 20));
    const st = await q.status(id);
    expect(st.status).toBe("paused");
    expect(st.pending).toBeGreaterThan(0);
    expect(st.pending + st.done_ok).toBe(10);
  });

  it("cancel menghentikan sisa pekerjaan", async () => {
    const id = await startJob(range(1, 10));
    let n = 0;
    hook = () => { if (++n === 2) void q.control(id, "cancel"); };
    await q.runSlice(client());
    await new Promise((r) => setTimeout(r, 20));
    expect((await q.status(id)).status).toBe("cancelled");
    expect(updates.length).toBeLessThan(10);
  });

  it("dua worker bersamaan tidak memproses job yang sama", async () => {
    const id = await startJob(range(1, 6));
    (getStore() as MemStore).locks.add(`shopee:joblock:${id}`);
    const r = await q.runSlice(client());
    expect(r.jobs).toEqual([]);
    expect(r.more).toBe(false); // jangan berantai tanpa henti
    expect(updates).toEqual([]);
  });

  it("job diproses berurutan sesuai waktu dibuat", async () => {
    const a = await startJob([1, 2]);
    await new Promise((r) => setTimeout(r, 5));
    const b = await startJob([3, 4]);
    await q.runSlice(client());
    expect(updates).toEqual([1, 2, 3, 4]);
    expect((await q.status(a)).status).toBe("completed");
    expect((await q.status(b)).status).toBe("completed");
  });
});

describe("rollback", () => {
  it("memulihkan nilai asli, hanya produk yang berhasil diubah", async () => {
    hook = (id) => (id === 3 ? err("error_param") : undefined);
    const id = await startJob([1, 2, 3]);
    await q.runSlice(client());
    hook = () => undefined;
    const rb = await q.control(id, "rollback");
    expect(rb.restoring).toBe(2);
    await q.runSlice(client());
    expect(names[1]).toBe("Nama lama produk nomor 1 abc");
    expect(names[2]).toBe("Nama lama produk nomor 2 abc");
    expect(names[3]).toBe("Nama lama produk nomor 3 abc"); // tak pernah berubah
    expect((await q.status(rb.job_id as string)).kind).toBe("rollback");
  });

  it("nilai asli tidak tertimpa saat produk diproses ulang (aman dari crash)", async () => {
    const id = await startJob([1]);
    await q.runSlice(client());
    // simulasi crash: produk sudah berubah di Shopee tetapi progres belum tercatat
    const store = getStore() as MemStore;
    const item = await store.hget<any>(KEYS.items(id), "1");
    await store.hset(KEYS.items(id), "1", { ...item, status: "pending" });
    const p = (await q.getProgress(id))!;
    await store.hset(KEYS.progress, id, { ...p, ok: 0, pending: [1], finished_at: undefined });
    await q.runSlice(client());
    const rb = await q.control(id, "rollback");
    await q.runSlice(client());
    expect(rb.restoring).toBe(1);
    expect(names[1]).toBe("Nama lama produk nomor 1 abc");
  });
});

describe("kontrol", () => {
  it("tidak bisa retry saat sedang berjalan / start dua kali", async () => {
    const id = await startJob([1, 2]);
    expect((await q.control(id, "start")).note).toMatch(/sudah/);
    await q.runSlice(client());
    await expect(q.control(id, "retry_failed")).rejects.toThrow(/Tidak ada produk gagal/);
  });

  it("queue_list menampilkan job terbaru", async () => {
    await startJob([1]);
    const list = await q.listJobs();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ total: 1, pending: 1, status: "queued" });
  });
});
