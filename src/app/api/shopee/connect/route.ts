import { NextResponse } from "next/server";
import { isAuthorized, oauthState } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { ShopeeClient } from "@/lib/shopee";

export const dynamic = "force-dynamic";

/** Buka /api/shopee/connect?key=MCP_SECRET di browser, login sebagai seller, lalu izinkan. Ulangi per toko. */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthorized(req, cfg.mcpSecret)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.redirect(new ShopeeClient(cfg).authUrl(oauthState(cfg.mcpSecret)));
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), { status: 500 });
  }
}
