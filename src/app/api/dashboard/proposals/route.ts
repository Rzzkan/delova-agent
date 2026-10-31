import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed, isJsonRequest } from "@/lib/dashboard";
import { makeClients } from "@/lib/productAdmin";
import * as pr from "@/lib/proposals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const err = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
const STATUSES = ["pending", "applied", "rejected", "failed", "stale", "reverted", "all"];

/** GET ?status=pending|applied|...|all&platform=shopee|tiktok */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const status = u.get("status") ?? "pending";
  const platform = u.get("platform");
  if (!STATUSES.includes(status)) return err("status tidak dikenal", 400);
  try {
    const list = await pr.listProposals({ status: status as pr.Status | "all", platform: platform === "shopee" || platform === "tiktok" ? platform : undefined });
    return NextResponse.json({ read_only: cfg.readOnly, groups: pr.groupByBrand(list), total: list.length }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return err(e);
  }
}

/** POST {action: "approve"|"reject"|"revert", ids: string[]} */
export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isJsonRequest(req)) return err("bad request", 415);
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown };
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return err("ids kosong", 400);
  try {
    if (b.action === "reject") return NextResponse.json(await pr.reject(ids));
    if (b.action !== "approve" && b.action !== "revert") return err("aksi tidak dikenal", 400);
    if (cfg.readOnly) return err("Mode baca-saja aktif (SHOPEE_READ_ONLY=true): perubahan ke marketplace diblokir.", 403);
    const clients = makeClients(cfg);
    return NextResponse.json(b.action === "approve" ? await pr.approve(clients, ids) : await pr.revert(clients, ids));
  } catch (e) {
    return err(e, 400);
  }
}
