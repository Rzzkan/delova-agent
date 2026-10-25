/** Pembatas percobaan login per IP (memori proses). Cukup untuk satu container di belakang satu reverse proxy. */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, number[]>();

/** IP klien: entri TERAKHIR X-Forwarded-For (ditambahkan proxy tepercaya, mis. Caddy), bukan yang bisa dipalsukan klien. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)!.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function isBlocked(ip: string, now = Date.now()): boolean {
  const recent = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length) fails.set(ip, recent);
  else fails.delete(ip);
  return recent.length >= MAX_FAILS;
}

export function recordFail(ip: string, now = Date.now()) {
  fails.set(ip, [...(fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS), now]);
  if (fails.size > 5000) fails.clear(); // jaga memori
}

export function reset(ip: string) {
  fails.delete(ip);
}
