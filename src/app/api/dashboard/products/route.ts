import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed } from "@/lib/dashboard";
import * as pa from "@/lib/productAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const err = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
const NOSTORE = { "cache-control": "no-store" };

/** Hanya baca. GET ?platform=&view=shops|list|detail|log&shop=&status=&cursor=&q=&id= */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const platform = u.get("platform");
  if (platform !== "shopee" && platform !== "tiktok") return err("platform harus shopee atau tiktok", 400);
  const view = u.get("view") ?? "list";
  const shop = u.get("shop") ?? "";
  try {
    const clients = pa.makeClients(cfg);
    if (view === "shops") return NextResponse.json({ limits: pa.limitsFor(platform), shops: await pa.productShops(clients, platform) }, { headers: NOSTORE });
    if (!shop) return err("parameter shop wajib", 400);
    if (view === "detail") return NextResponse.json(await pa.getDetail(clients, platform, shop, u.get("id") ?? ""), { headers: NOSTORE });
    if (view === "log") return NextResponse.json({ log: await pa.listLog(platform, shop, u.get("id") ?? undefined) }, { headers: NOSTORE });
    return NextResponse.json(await pa.listProducts(clients, platform, shop, { status: u.get("status") ?? undefined, cursor: u.get("cursor") ?? undefined, q: u.get("q") ?? undefined }), { headers: NOSTORE });
  } catch (e) {
    return err(e);
  }
}
