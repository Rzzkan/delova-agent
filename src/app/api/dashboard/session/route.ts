import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** Cek ringan apakah sesi dashboard masih sah (dipakai semua halaman dashboard). */
export async function GET(req: Request) {
  if (!isAuthed(req, loadConfig().mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
