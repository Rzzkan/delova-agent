/**
 * Antrian edit massal (nama/deskripsi produk).
 *
 * Alur: queue_enqueue (draft, bisa ditambah bertahap) -> start -> worker memproses per "slice"
 * (~38 dtk, muat dalam batas fungsi Vercel) -> worker memicu dirinya sendiri sampai antrian habis.
 * Penggerak cadangan: Vercel Cron dan tool queue_run dari chat Claude.
 *
 * Konsistensi: status kontrol (draft/queued/paused/cancelled) hanya ditulis oleh pengguna/tool,
 * progres hanya ditulis oleh worker yang memegang lock job. Dengan begitu pause/cancel tidak
 * tertimpa oleh worker.
 */
import { randomBytes } from "node:crypto";
import { Config } from "./config";
import * as products from "./products";
import * as seo from "./seo";
import { ShopeeClient, ShopeeError } from "./shopee";
import { KEYS, getStore } from "./store";

export const MAX_JOB_ITEMS = 2000;
export const MAX_PER_ENQUEUE = 100;
const BATCH = 20; // produk per get_item_base_info
const MAX_ATTEMPTS = 3; // percobaan untuk error sementara
const MAX_CONSECUTIVE_FAILURES = 5; // circuit breaker -> pause
const LOCK_TTL = 75;
const HEARTBEAT_FRESH_MS = 90_000;
export const ITEMS_PER_MINUTE = 90; // perkiraan untuk ETA

export type ControlStatus = "draft" | "queued" | "paused" | "cancelled";

export interface JobMeta {
  id: string;
  shop_id: number;
  label?: string;
  kind: "edit" | "rollback";
  rollback_of?: string;
  status: ControlStatus;
  pause_reason?: string;
  created_at: string;
  started_at?: string;
}

export interface Progress {
  total: number;
  ok: number; // termasuk "tanpa perubahan"
  failed: number;
  pending: number[]; // urutan antrean
  failed_ids: number[];
  consecutive_failures: number;
  heartbeat: number; // ms epoch
  finished_at?: string;
  last_error?: string;
}

export interface JobItem {
  item_id: number;
  name?: string;
  description?: string;
  status: "pending" | "ok" | "unchanged" | "failed";
  attempts: number;
  error?: string;
  original?: { name: string; description: string; description_type: "normal" | "extended" };
}

export type DisplayStatus = ControlStatus | "running" | "completed" | "completed_with_errors";

const store = () => getStore();
const nowIso = () => new Date().toISOString();
/** Dapat diubah di tes. */
export const tuning = { retrySleepMs: 1500, batchErrorSleepMs: 2000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const getMeta = (id: string) => store().hget<JobMeta>(KEYS.jobs, id);
export const getProgress = (id: string) => store().hget<Progress>(KEYS.progress, id);

export function displayStatus(meta: JobMeta, p: Progress): DisplayStatus {
  if (meta.status === "draft" || meta.status === "paused" || meta.status === "cancelled") return meta.status;
  if (p.pending.length === 0) return p.failed > 0 ? "completed_with_errors" : "completed";
  return Date.now() - p.heartbeat < HEARTBEAT_FRESH_MS ? "running" : "queued";
}

// ---------------------------------------------------------------- enqueue

export async function enqueue(o: {
  shopId: number;
  changes: { item_id: number; name?: string; description?: string }[];
  jobId?: string;
  label?: string;
}) {
  if (o.changes.length > MAX_PER_ENQUEUE) throw new Error(`Maks ${MAX_PER_ENQUEUE} produk per panggilan queue_enqueue.`);
  let meta: JobMeta | null;
  let prog: Progress;
  if (o.jobId) {
    meta = await getMeta(o.jobId);
    if (!meta) throw new Error(`job_id ${o.jobId} tidak ditemukan`);
    if (meta.status !== "draft") throw new Error(`Job sudah ${meta.status}; produk hanya bisa ditambah saat masih draft. Buat job baru.`);
    if (meta.shop_id !== o.shopId) throw new Error("shop_id tidak sama dengan job.");
    prog = (await getProgress(o.jobId))!;
  } else {
    meta = {
      id: `${nowIso().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`,
      shop_id: o.shopId,
      label: o.label,
      kind: "edit",
      status: "draft",
      created_at: nowIso(),
    };
    prog = { total: 0, ok: 0, failed: 0, pending: [], failed_ids: [], consecutive_failures: 0, heartbeat: 0 };
  }

  const accepted: Record<string, JobItem> = {};
  const rejected: { item_id: number; errors: string[] }[] = [];
  for (const ch of o.changes) {
    const errors = seo.blockingErrors(ch.name, ch.description);
    if (ch.name === undefined && ch.description === undefined) errors.push("tidak ada name/description");
    if (errors.length) {
      rejected.push({ item_id: ch.item_id, errors });
      continue;
    }
    accepted[String(ch.item_id)] = { item_id: ch.item_id, name: ch.name, description: ch.description, status: "pending", attempts: 0 };
  }

  const known = new Set(prog.pending);
  const fresh = Object.values(accepted).filter((i) => !known.has(i.item_id));
  if (prog.total + fresh.length > MAX_JOB_ITEMS) throw new Error(`Maks ${MAX_JOB_ITEMS} produk per job; buat job baru.`);

  await store().hsetMany(KEYS.items(meta.id), accepted); // produk yang sama ditimpa (versi terbaru menang)
  prog.pending.push(...fresh.map((i) => i.item_id));
  prog.total = prog.pending.length;
  await store().hset(KEYS.jobs, meta.id, meta);
  await store().hset(KEYS.progress, meta.id, prog);
  return { job_id: meta.id, status: meta.status, accepted: Object.keys(accepted).length, rejected, total_in_job: prog.total };
}

// ---------------------------------------------------------------- control

export type Action = "start" | "pause" | "resume" | "cancel" | "retry_failed" | "rollback";

export async function control(jobId: string, action: Action): Promise<Record<string, unknown>> {
  const meta = await getMeta(jobId);
  if (!meta) throw new Error(`job_id ${jobId} tidak ditemukan`);
  const prog = (await getProgress(jobId))!;
  const set = (m: JobMeta) => store().hset(KEYS.jobs, jobId, m);
  const running = displayStatus(meta, prog) === "running";

  switch (action) {
    case "start":
    case "resume": {
      if (meta.status === "cancelled") throw new Error("Job sudah dibatalkan.");
      if (meta.status === "queued") return { job_id: jobId, status: displayStatus(meta, prog), note: "Job sudah berjalan/antri." };
      if (action === "start" && meta.status !== "draft") throw new Error(`Job sudah ${meta.status}; pakai resume.`);
      if (!prog.pending.length) throw new Error("Tidak ada produk menunggu di job ini.");
      prog.consecutive_failures = 0;
      await store().hset(KEYS.progress, jobId, prog); // aman: job belum/tidak sedang diproses (paused)
      await set({ ...meta, status: "queued", pause_reason: undefined, started_at: meta.started_at ?? nowIso() });
      return { job_id: jobId, status: "queued", pending: prog.pending.length };
    }
    case "pause":
      await set({ ...meta, status: "paused", pause_reason: "dijeda manual" });
      return { job_id: jobId, status: "paused" };
    case "cancel":
      await set({ ...meta, status: "cancelled" });
      return { job_id: jobId, status: "cancelled", note: "Produk yang sudah terubah tetap; gunakan action=rollback untuk memulihkannya." };
    case "retry_failed": {
      if (meta.status === "cancelled") throw new Error("Job sudah dibatalkan.");
      if (running) throw new Error("Job sedang berjalan; jeda (pause) dulu lalu coba lagi.");
      if (!prog.failed_ids.length) throw new Error("Tidak ada produk gagal.");
      const items = KEYS.items(jobId);
      for (const id of prog.failed_ids) {
        const it = await store().hget<JobItem>(items, String(id));
        if (it) await store().hset(items, String(id), { ...it, status: "pending", attempts: 0, error: undefined });
      }
      prog.pending.push(...prog.failed_ids);
      prog.failed -= prog.failed_ids.length;
      prog.failed_ids = [];
      prog.consecutive_failures = 0;
      prog.finished_at = undefined;
      await store().hset(KEYS.progress, jobId, prog);
      await set({ ...meta, status: "queued", pause_reason: undefined });
      return { job_id: jobId, status: "queued", requeued: prog.pending.length };
    }
    case "rollback":
      return rollbackJob(meta, jobId);
  }
}

/** Buat job baru yang mengembalikan nilai asli semua produk yang sudah diubah job ini. */
async function rollbackJob(meta: JobMeta, jobId: string) {
  const all = await store().hgetall<JobItem>(KEYS.items(jobId));
  const restore: Record<string, JobItem> = {};
  for (const it of Object.values(all)) {
    // 'ok' atau 'unchanged' (produk yang diproses ulang setelah crash sudah berisi nilai baru):
    // yang menentukan adalah apakah nilai asli berbeda dari nilai target job ini.
    if ((it.status !== "ok" && it.status !== "unchanged") || !it.original) continue;
    const name = it.name !== undefined && it.original.name !== it.name ? it.original.name : undefined;
    const description =
      it.description !== undefined && it.original.description !== it.description ? it.original.description : undefined;
    if (name === undefined && description === undefined) continue;
    restore[String(it.item_id)] = { item_id: it.item_id, name, description, status: "pending", attempts: 0 };
  }
  const ids = Object.values(restore).map((i) => i.item_id);
  if (!ids.length) throw new Error("Tidak ada produk berhasil-diubah yang bisa dipulihkan.");
  const id = `${nowIso().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  await store().hsetMany(KEYS.items(id), restore);
  await store().hset(KEYS.progress, id, {
    total: ids.length, ok: 0, failed: 0, pending: ids, failed_ids: [], consecutive_failures: 0, heartbeat: 0,
  } satisfies Progress);
  await store().hset(KEYS.jobs, id, {
    id, shop_id: meta.shop_id, kind: "rollback", rollback_of: jobId, label: `rollback ${jobId}`,
    status: "queued", created_at: nowIso(), started_at: nowIso(),
  } satisfies JobMeta);
  return { job_id: id, status: "queued", restoring: ids.length };
}

// ---------------------------------------------------------------- status

export async function status(jobId: string) {
  const meta = await getMeta(jobId);
  if (!meta) throw new Error(`job_id ${jobId} tidak ditemukan`);
  const p = (await getProgress(jobId))!;
  const failures: { item_id: number; error?: string; attempts: number }[] = [];
  for (const id of p.failed_ids.slice(0, 20)) {
    const it = await store().hget<JobItem>(KEYS.items(jobId), String(id));
    if (it) failures.push({ item_id: it.item_id, error: it.error, attempts: it.attempts });
  }
  return {
    job_id: jobId,
    label: meta.label,
    kind: meta.kind,
    shop_id: meta.shop_id,
    status: displayStatus(meta, p),
    pause_reason: meta.pause_reason,
    total: p.total,
    done_ok: p.ok,
    failed: p.failed,
    pending: p.pending.length,
    eta_minutes: p.pending.length ? Math.ceil(p.pending.length / ITEMS_PER_MINUTE) : 0,
    last_error: p.last_error,
    failures_sample: failures,
    created_at: meta.created_at,
    finished_at: p.finished_at,
  };
}

export async function listJobs(limit = 15) {
  const metas = Object.values(await store().hgetall<JobMeta>(KEYS.jobs))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
  const out = [];
  for (const m of metas) {
    const p = (await getProgress(m.id))!;
    out.push({
      job_id: m.id, label: m.label, kind: m.kind, shop_id: m.shop_id, status: displayStatus(m, p),
      total: p.total, ok: p.ok, failed: p.failed, pending: p.pending.length, created_at: m.created_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------- worker

function classify(e: unknown): "auth" | "transient" | "permanent" {
  if (e instanceof ShopeeError) {
    if (/error_auth|access_token|invalid_acc|permission/i.test(e.code)) return "auth";
    if (/error_server|error_busy|error_inner|rate|too_many|^http_5|^http_429/i.test(e.code)) return "transient";
    return "permanent";
  }
  const name = (e as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError" || e instanceof TypeError) return "transient"; // jaringan
  return "permanent";
}

const errText = (e: unknown) => (e instanceof ShopeeError ? `${e.code}: ${e.detail}` : e instanceof Error ? e.message : String(e));

export interface SliceResult {
  processed: number;
  ok: number;
  failed: number;
  more: boolean; // masih ada pekerjaan yang bisa dijalankan
  jobs: string[];
}

/** Proses antrian sampai anggaran waktu habis. Aman dipanggil bersamaan (dijaga lock per job). */
export async function runSlice(c: ShopeeClient, budgetMs = 38_000): Promise<SliceResult> {
  const deadline = Date.now() + budgetMs;
  const res: SliceResult = { processed: 0, ok: 0, failed: 0, more: false, jobs: [] };

  const metas = Object.values(await store().hgetall<JobMeta>(KEYS.jobs))
    .filter((m) => m.status === "queued")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const m of metas) {
    if (Date.now() >= deadline) break;
    const lock = `shopee:joblock:${m.id}`;
    if (!(await store().lock(lock, LOCK_TTL))) continue;
    try {
      res.jobs.push(m.id);
      await processJob(c, m.id, deadline, res);
    } finally {
      await store().unlock(lock);
    }
  }

  // Lanjutkan berantai HANYA bila invocation ini memegang job (kalau semua terkunci oleh worker lain,
  // worker itu yang akan melanjutkan; kalau tidak, pemicu akan berputar tanpa henti).
  if (res.jobs.length) {
    for (const m of Object.values(await store().hgetall<JobMeta>(KEYS.jobs))) {
      if (m.status !== "queued") continue;
      const p = await getProgress(m.id);
      if (p && p.pending.length) {
        res.more = true;
        break;
      }
    }
  }
  return res;
}

async function processJob(c: ShopeeClient, jobId: string, deadline: number, res: SliceResult) {
  const itemsKey = KEYS.items(jobId);
  while (Date.now() < deadline) {
    const meta = await getMeta(jobId); // baca ulang: hormati pause/cancel
    if (!meta || meta.status !== "queued") return;
    const p = (await getProgress(jobId))!;
    if (!p.pending.length) {
      p.finished_at ??= nowIso();
      await store().hset(KEYS.progress, jobId, p);
      return;
    }

    const batchIds = p.pending.slice(0, BATCH);
    let base: Map<number, products.SlimItem>;
    try {
      base = new Map((await products.getBaseInfo(c, meta.shop_id, batchIds)).map((i) => [i.item_id as number, products.slim(i)]));
    } catch (e) {
      const kind = classify(e);
      p.last_error = errText(e);
      p.heartbeat = Date.now();
      p.consecutive_failures++;
      await store().hset(KEYS.progress, jobId, p);
      if (kind === "auth" || p.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
        await pause(meta, kind === "auth" ? `masalah otorisasi: ${p.last_error}` : `gagal berturut-turut: ${p.last_error}`);
        return;
      }
      await sleep(kind === "transient" ? tuning.batchErrorSleepMs : 500);
      continue;
    }

    for (const id of batchIds) {
      if (Date.now() >= deadline) break;
      const fresh = await getMeta(jobId);
      if (!fresh || fresh.status !== "queued") return;

      const item = await store().hget<JobItem>(itemsKey, String(id));
      p.pending.shift(); // id selalu di depan antrian
      if (!item) {
        markFailed(p, id);
        p.heartbeat = Date.now();
        await store().hset(KEYS.progress, jobId, p);
        res.failed++;
        res.processed++;
        continue;
      }

      const cur = base.get(id);
      let outcome: "ok" | "unchanged" | "failed" | "retry" = "ok";
      if (!cur) {
        item.error = "produk tidak ditemukan di toko";
        outcome = "failed";
      } else {
        // simpan nilai asli SEBELUM menulis; jangan timpa bila job ini pernah menyentuh produk (crash-safe)
        if (!item.original) {
          item.original = { name: cur.item_name, description: cur.description, description_type: cur.description_type };
          await store().hset(itemsKey, String(id), item);
        }
        const nameChanged = item.name !== undefined && item.name !== cur.item_name;
        const descChanged = item.description !== undefined && item.description !== cur.description;
        if (!nameChanged && !descChanged) {
          outcome = "unchanged";
        } else {
          try {
            await products.updateItem(c, meta.shop_id, id, {
              name: nameChanged ? item.name : undefined,
              description: descChanged ? item.description : undefined,
              descriptionType: cur.description_type,
            });
          } catch (e) {
            const kind = classify(e);
            item.error = errText(e);
            p.last_error = item.error;
            item.attempts++;
            if (kind === "auth") {
              p.pending.unshift(id); // kembalikan; job dijeda
              await store().hset(itemsKey, String(id), item);
              await store().hset(KEYS.progress, jobId, p);
              await pause(meta, `masalah otorisasi: ${item.error}`);
              return;
            }
            outcome = kind === "transient" && item.attempts < MAX_ATTEMPTS ? "retry" : "failed";
          }
        }
      }

      res.processed++;
      if (outcome === "retry") {
        p.pending.push(id); // coba lagi nanti, di belakang antrian
        p.consecutive_failures++;
        await sleep(tuning.retrySleepMs);
      } else if (outcome === "failed") {
        item.status = "failed";
        markFailed(p, id);
        res.failed++;
      } else {
        item.status = outcome === "unchanged" ? "unchanged" : "ok";
        item.error = undefined;
        p.ok++;
        p.consecutive_failures = 0;
        res.ok++;
      }
      await store().hset(itemsKey, String(id), item);
      p.heartbeat = Date.now();
      await store().hset(KEYS.progress, jobId, p);

      if (p.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
        await pause(meta, `gagal berturut-turut: ${p.last_error}`);
        return;
      }
    }
  }
}

function markFailed(p: Progress, id: number) {
  p.failed++;
  p.failed_ids.push(id);
  p.consecutive_failures++;
}

async function pause(meta: JobMeta, reason: string) {
  await store().hset(KEYS.jobs, meta.id, { ...meta, status: "paused", pause_reason: reason });
}

// ---------------------------------------------------------------- pemicu worker

/** Picu satu slice di invocation baru (worker membalas 202 lalu bekerja di belakang). */
export async function kickWorker(cfg: Config): Promise<void> {
  if (!cfg.mcpSecret) return;
  try {
    await fetch(`${cfg.baseUrl}/api/worker/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.mcpSecret}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* gagal memicu bukan masalah fatal: cron / queue_run akan melanjutkan */
  }
}

/** Jadwalkan kick setelah respons terkirim (Next `after`), jatuh ke fire-and-forget bila tidak tersedia. */
export async function scheduleKick(cfg: Config): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(() => kickWorker(cfg));
  } catch {
    void kickWorker(cfg);
  }
}
