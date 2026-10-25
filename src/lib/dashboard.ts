/** Logika dashboard: sesi login (cookie), ringkasan toko & antrian. Token Shopee TIDAK pernah dikirim ke browser. */
import { createHmac } from "node:crypto";
import { isAuthorized, safeEqual } from "./auth";
import { Config, loadTikTokConfig, tiktokConfigured } from "./config";
import * as queue from "./queue";
import type { Platform } from "./queue";
import { ShopeeClient } from "./shopee";
import { storeKind } from "./store";
import { TikTokClient } from "./tiktok";

export const COOKIE = "sa_session";
export const SESSION_SECONDS = 7 * 86400;
const SOON_SECONDS = 5 * 86400;

/** Nilai cookie sesi: diturunkan dari rahasia, jadi mengganti MCP_SECRET otomatis mencabut semua sesi. */
export function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update("dashboard-session-v1").digest("hex");
}

export function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/** Terima cookie sesi dashboard, atau Bearer/?key= seperti endpoint lain. */
export function isAuthed(req: Request, secret: string): boolean {
  if (secret.length < 16) return false;
  if (isAuthorized(req, secret)) return true;
  const c = readCookie(req, COOKIE);
  return c !== "" && safeEqual(c, sessionToken(secret));
}

/** Perlindungan CSRF untuk aksi tulis: cookie SameSite=Strict + wajib JSON (tidak bisa dikirim form lintas situs). */
export function isJsonRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export type ShopHealth = "active" | "expiring" | "expired" | "unknown";

export function shopHealth(refreshExpireAt: number | undefined, nowSec = Date.now() / 1000): ShopHealth {
  if (!refreshExpireAt) return "unknown";
  if (refreshExpireAt <= nowSec) return "expired";
  return refreshExpireAt - nowSec < SOON_SECONDS ? "expiring" : "active";
}

export async function overview(cfg: Config) {
  const ttCfg = loadTikTokConfig();
  const shopee = await new ShopeeClient(cfg).shops();
  const ttClient = new TikTokClient(cfg, ttCfg);
  const ttShops = await ttClient.shops();
  const ttAuth = new Map((await ttClient.auths()).map((a) => [a.open_id, a]));
  const now = Date.now() / 1000;

  const shops = [
    ...shopee.map((s) => ({
      platform: "shopee" as Platform,
      shop_id: String(s.shop_id),
      shop_name: s.shop_name ?? null,
      region: null as string | null,
      health: shopHealth(s.refresh_expire_at, now),
      refresh_expire_at: s.refresh_expire_at ?? null,
      days_left: s.refresh_expire_at ? Math.floor((s.refresh_expire_at - now) / 86400) : null,
      connected_at: s.connected_at ?? null,
      estimated: true, // Shopee tidak memberi tanggal; ini perkiraan 30 hari sejak refresh terakhir
    })),
    ...ttShops.map((s) => {
      const a = ttAuth.get(s.open_id);
      return {
        platform: "tiktok" as Platform,
        shop_id: s.shop_id,
        shop_name: s.shop_name ?? null,
        region: s.region ?? null,
        health: shopHealth(a?.refresh_expire_at, now),
        refresh_expire_at: a?.refresh_expire_at ?? null,
        days_left: a?.refresh_expire_at ? Math.floor((a.refresh_expire_at - now) / 86400) : null,
        connected_at: a?.connected_at ?? null,
        estimated: false, // tanggal resmi dari TikTok
      };
    }),
  ].sort((x, y) => x.platform.localeCompare(y.platform) || x.shop_id.localeCompare(y.shop_id, "en", { numeric: true }));
  // sengaja hanya field aman; access_token / refresh_token tidak ikut

  const names = new Map(shops.map((s) => [`${s.platform}:${s.shop_id}`, s.shop_name]));
  const jobs = (await queue.listJobs(30)).map((j) => ({ ...j, shop_name: names.get(`${j.platform}:${j.shop_id}`) ?? null }));
  return {
    generated_at: new Date().toISOString(),
    server: { env: cfg.env, read_only: cfg.readOnly, store: storeKind(), tiktok_configured: tiktokConfigured(ttCfg) },
    shops,
    jobs,
    summary: {
      active_jobs: jobs.filter((j) => j.status === "queued" || j.status === "running").length,
      pending_items: jobs.filter((j) => j.status === "queued" || j.status === "running").reduce((n, j) => n + j.pending, 0),
      failed_items: jobs.reduce((n, j) => n + j.failed, 0),
    },
  };
}

export type Overview = Awaited<ReturnType<typeof overview>>;

export const ACTIONS = ["start", "pause", "resume", "cancel", "retry_failed", "rollback", "run_worker"] as const;
export type DashboardAction = (typeof ACTIONS)[number];

export async function runAction(cfg: Config, jobId: string | undefined, action: DashboardAction) {
  if (action === "run_worker") {
    await queue.scheduleKick(cfg);
    return { ok: true, note: "Worker dipicu." };
  }
  if (!jobId) throw new Error("job_id wajib");
  const r = await queue.control(jobId, action);
  if (["start", "resume", "retry_failed", "rollback"].includes(action)) await queue.scheduleKick(cfg);
  return r;
}
