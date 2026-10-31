import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed, isJsonRequest } from "@/lib/dashboard";
import * as pa from "@/lib/productAdmin";
import { PARAMS, RUBRIC_DATE, BAKU_DOC_ID, rubricVersion } from "@/lib/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** GET: rubrik yang sedang dipakai. POST {platform, shop, id, fresh?}: skor AI (hasil di-cache per versi rubrik + isi listing). */
export async function GET(req: Request) {
  if (!isAuthed(req, loadConfig().mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ version: rubricVersion(), date: RUBRIC_DATE, doc: `https://docs.google.com/document/d/${BAKU_DOC_ID}/edit`, params: PARAMS }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isJsonRequest(req)) return NextResponse.json({ error: "bad request" }, { status: 415 });
  try {
    const b = await req.json();
    if ((b.platform !== "shopee" && b.platform !== "tiktok") || !b.shop || !b.id) return NextResponse.json({ error: "platform, shop, id wajib" }, { status: 400 });
    const r = await pa.aiScoreProduct(pa.makeClients(cfg), b.platform, String(b.shop), String(b.id), Boolean(b.fresh));
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
