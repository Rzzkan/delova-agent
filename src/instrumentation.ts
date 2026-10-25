/**
 * Penjadwal worker untuk deploy Docker/VPS .
 * Aktif bila WORKER_INTERVAL_SECONDS diisi (>0): tiap interval memanggil worker lokal sebagai jaring pengaman,
 * sehingga antrian yang macet (restart container, rantai terputus) tetap lanjut tanpa cron eksternal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const every = Number(process.env.WORKER_INTERVAL_SECONDS ?? 0);
  const secret = process.env.MCP_SECRET ?? "";
  if (!(every > 0) || secret.length < 16) return;
  const base = (process.env.WORKER_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  const timer = setInterval(() => {
    fetch(`${base}/api/worker/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      /* server belum siap / sedang restart: tick berikutnya mencoba lagi */
    });
  }, Math.max(15, every) * 1000);
  timer.unref();
}
