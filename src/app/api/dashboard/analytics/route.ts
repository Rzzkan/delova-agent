import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed, isJsonRequest } from "@/lib/dashboard";
import { buildReport } from "@/lib/analytics";
import { insightFor, llmReady, resolveLlmConfig } from "@/lib/llm";
import { ShopeeClient } from "@/lib/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const err = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
const DAYS = [7, 14, 30];
const NOSTORE = { "cache-control": "no-store" };

/** GET ?view=shops | GET ?shop=&days=7|14|30&refresh=1 */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    const c = new ShopeeClient(cfg);
    if (u.get("view") === "shops") {
      return NextResponse.json({ ai_ready: llmReady(await resolveLlmConfig(cfg.mcpSecret)), shops: (await c.shops()).map((s) => ({ shop_id: String(s.shop_id), shop_name: s.shop_name ?? null })) }, { headers: NOSTORE });
    }
    const shop = Number(u.get("shop"));
    const days = Number(u.get("days") ?? 7);
    if (!Number.isInteger(shop) || shop <= 0) return err("parameter shop wajib", 400);
    if (!DAYS.includes(days)) return err("days harus 7, 14, atau 30", 400);
    return NextResponse.json(await buildReport(c, shop, days, { force: u.get("refresh") === "1" }), { headers: NOSTORE });
  } catch (e) {
    return err(e);
  }
}

/** POST {shop, days, fresh?} -> insight AI dari laporan (cache 6 jam) */
export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isJsonRequest(req)) return err("bad request", 415);
  const b = (await req.json().catch(() => ({}))) as { shop?: unknown; days?: unknown; fresh?: unknown };
  const shop = Number(b.shop);
  const days = Number(b.days ?? 7);
  if (!Number.isInteger(shop) || shop <= 0 || !DAYS.includes(days)) return err("shop/days tidak valid", 400);
  const llm = await resolveLlmConfig(cfg.mcpSecret);
  if (!llmReady(llm)) return err("Model AI belum diatur. Buka menu Pengaturan AI untuk mengisi model dan kunci.", 409);
  try {
    const report = await buildReport(new ShopeeClient(cfg), shop, days);
    return NextResponse.json({ insight: await insightFor(report, { fresh: b.fresh === true, cfg: llm }) });
  } catch (e) {
    return err(e, 502);
  }
}
