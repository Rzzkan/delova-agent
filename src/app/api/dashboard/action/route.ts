import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { ACTIONS, DashboardAction, isAuthed, isJsonRequest, runAction } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isJsonRequest(req)) return NextResponse.json({ error: "bad request" }, { status: 415 });
  const body = (await req.json().catch(() => ({}))) as { job_id?: string; action?: string };
  if (!ACTIONS.includes(body.action as DashboardAction)) {
    return NextResponse.json({ error: "aksi tidak dikenal" }, { status: 400 });
  }
  try {
    return NextResponse.json(await runAction(cfg, body.job_id, body.action as DashboardAction));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
