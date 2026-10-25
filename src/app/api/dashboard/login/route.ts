import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { COOKIE, SESSION_SECONDS, isJsonRequest, sessionToken } from "@/lib/dashboard";
import { clientIp, isBlocked, recordFail, reset } from "@/lib/throttle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isJsonRequest(req)) return NextResponse.json({ error: "bad request" }, { status: 415 });
  const ip = clientIp(req);
  if (isBlocked(ip)) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (cfg.mcpSecret.length < 16 || !key || !safeEqual(key, cfg.mcpSecret)) {
    recordFail(ip);
    await new Promise((r) => setTimeout(r, 600)); // memperlambat tebakan
    return NextResponse.json({ error: "Kunci salah" }, { status: 401 });
  }
  reset(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, sessionToken(cfg.mcpSecret), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
