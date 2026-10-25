import { after } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { loadConfig, loadTikTokConfig, tiktokConfigured } from "@/lib/config";
import { kickWorker, runSlice } from "@/lib/queue";
import { ShopeeClient } from "@/lib/shopee";
import { TikTokClient } from "@/lib/tiktok";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Worker antrian. Membalas 202 segera, lalu bekerja di belakang (after) selama ~38 dtk,
 * dan memicu dirinya sendiri lagi bila antrian belum habis.
 * Pemanggil: dirinya sendiri (POST + Bearer), penjadwal internal (Bearer MCP_SECRET).
 */
async function run(req: Request): Promise<Response> {
  const cfg = loadConfig();
  if (!isAuthorized(req, cfg.mcpSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  after(async () => {
    try {
      const ttCfg = loadTikTokConfig();
      const r = await runSlice(new ShopeeClient(cfg), undefined, tiktokConfigured(ttCfg) ? new TikTokClient(cfg, ttCfg) : undefined);
      if (r.more) await kickWorker(cfg);
    } catch (e) {
      console.error("worker slice gagal:", e);
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}

export { run as GET, run as POST };
