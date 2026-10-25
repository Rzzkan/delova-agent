import { NextResponse } from "next/server";
import { oauthState } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { isAuthed } from "@/lib/dashboard";
import { ShopeeClient } from "@/lib/shopee";

export const dynamic = "force-dynamic";

/** Buka dari dashboard (sudah login) atau /api/shopee/connect?key=MCP_SECRET; login sebagai seller lalu izinkan. Ulangi per toko. */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.redirect(new ShopeeClient(cfg).authUrl(oauthState(cfg.mcpSecret)));
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), { status: 500 });
  }
}
