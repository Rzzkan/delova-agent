/** Autentikasi endpoint MCP & halaman connect: rahasia bersama (MCP_SECRET). */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function digest(s: string) {
  return createHash("sha256").update(s).digest();
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Terima `Authorization: Bearer <secret>` (Claude Code, curl) atau `?key=<secret>`
 * (connector Claude.ai yang tidak bisa mengirim header kustom).
 * Fail-closed: tanpa MCP_SECRET semua request ditolak.
 */
export function isAuthorized(req: Request, secret: string): boolean {
  if (secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return (bearer !== "" && safeEqual(bearer, secret)) || (key !== "" && safeEqual(key, secret));
}

/** State anti-CSRF untuk alur OAuth Shopee, diturunkan dari rahasia (stateless). */
export function oauthState(secret: string): string {
  return createHmac("sha256", secret).update("shopee-oauth-state").digest("hex").slice(0, 32);
}
