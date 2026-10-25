import { NextResponse } from "next/server";
import { COOKIE, isJsonRequest } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isJsonRequest(req)) return NextResponse.json({ error: "bad request" }, { status: 415 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
