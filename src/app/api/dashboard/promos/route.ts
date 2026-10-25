import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed } from "@/lib/dashboard";
import { upcomingPromosCached } from "@/lib/promos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await upcomingPromosCached(cfg, force), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
