import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as q from "../src/lib/queue";
import { createTcpRedisStore, setStoreForTests } from "../src/lib/store";
import { clientIp, isBlocked, recordFail, reset } from "../src/lib/throttle";

describe("throttle login", () => {
  it("memblokir setelah 10 gagal dan terbuka lagi setelah jendela lewat", () => {
    const ip = "9.9.9.9";
    const t0 = 1_000_000;
    for (let i = 0; i < 9; i++) recordFail(ip, t0 + i);
    expect(isBlocked(ip, t0 + 100)).toBe(false);
    recordFail(ip, t0 + 10);
    expect(isBlocked(ip, t0 + 100)).toBe(true);
    expect(isBlocked(ip, t0 + 16 * 60_000)).toBe(false);
    reset(ip);
  });
  it("IP diambil dari entri terakhir X-Forwarded-For (tidak bisa dipalsukan klien)", () => {
    const r = new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    expect(clientIp(r)).toBe("203.0.113.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

const hasRedis = existsSync("/usr/bin/redis-server");
describe.skipIf(!hasRedis)("store Redis TCP (redis-server nyata)", () => {
  let proc: ChildProcess;
  const port = 6391;
  beforeAll(async () => {
    proc = spawn("/usr/bin/redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 600));
  });
  afterAll(() => {
    proc.kill();
  });

  it("hset/hget/hsetMany/hgetall menjaga tipe (string besar tetap string) dan lock bersifat eksklusif", async () => {
    const s = createTcpRedisStore(`redis://127.0.0.1:${port}`);
    await s.hset("h", "a", { id: "7312345678901234567", n: 1 });
    await s.hsetMany("h", { b: [1, 2], c: "teks" });
    expect(await s.hget("h", "a")).toEqual({ id: "7312345678901234567", n: 1 });
    expect(await s.hget("h", "zzz")).toBeNull();
    expect(await s.hgetall("h")).toEqual({ a: { id: "7312345678901234567", n: 1 }, b: [1, 2], c: "teks" });
    expect(await s.lock("k", 5)).toBe(true);
    expect(await s.lock("k", 5)).toBe(false);
    await s.unlock("k");
    expect(await s.lock("k", 5)).toBe(true);
  });

  it("antrian TikTok/Shopee berjalan di atas Redis (enqueue -> status)", async () => {
    setStoreForTests(createTcpRedisStore(`redis://127.0.0.1:${port}`));
    const e = await q.enqueue({ shopId: "S1", platform: "tiktok", changes: [{ item_id: "7312345678901234567", name: "Kebaya Modern Wanita Brokat Premium Set Rok Batik" }] });
    const st = await q.status(e.job_id);
    expect([st.platform, st.pending, st.status]).toEqual(["tiktok", 1, "draft"]);
    setStoreForTests(null);
  });
});
