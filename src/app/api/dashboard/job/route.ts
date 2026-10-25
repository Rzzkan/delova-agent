import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed } from "@/lib/dashboard";
import * as queue from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Detail satu job (termasuk contoh produk gagal). */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    return NextResponse.json(await queue.status(id), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
