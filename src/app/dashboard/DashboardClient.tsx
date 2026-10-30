"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Overview } from "@/lib/dashboard";
import type { PromosOverview } from "@/lib/promos";
import { summarizePromos, summarizeVouchers } from "@/lib/summary";
import type { VouchersOverview } from "@/lib/vouchers";
import Shell, { useShell } from "./Shell";
import { BTN, BTN_DANGER, BTN_DEFAULT, BTN_PRIMARY, Badge, Card, Empty, Note, PLATFORM, PageTitle, Stat, TZ, fmt, fmtDay, fmtTime } from "./ui";

type Job = Overview["jobs"][number];
type Shop = Overview["shops"][number];
type Detail = {
  failures_sample: { item_id: number | string; error?: string; attempts: number }[];
  pause_reason?: string;
  last_error?: string;
  eta_minutes: number;
  finished_at?: string;
};


const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "mute" },
  queued: { label: "Antri", cls: "info" },
  running: { label: "Berjalan", cls: "info" },
  paused: { label: "Dijeda", cls: "warn" },
  cancelled: { label: "Dibatalkan", cls: "mute" },
  completed: { label: "Selesai", cls: "ok" },
  completed_with_errors: { label: "Selesai, ada yang gagal", cls: "warn" },
};
const HEALTH: Record<string, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "ok" },
  expiring: { label: "Segera berakhir", cls: "warn" },
  expired: { label: "Kedaluwarsa", cls: "bad" },
  unknown: { label: "Belum diketahui", cls: "mute" },
};

interface Btn {
  action: string;
  label: string;
  cls?: string;
  confirm?: string;
}

function buttonsFor(j: Job): Btn[] {
  const cancel: Btn = { action: "cancel", label: "Batalkan", cls: "danger", confirm: "Batalkan sisa job ini? Produk yang sudah berubah tetap berubah." };
  const rollback: Btn = { action: "rollback", label: "Rollback", confirm: "Buat job baru yang mengembalikan nama/deskripsi lama semua produk yang sudah diubah job ini?" };
  const canRollback = j.kind === "edit" && j.ok > 0;
  switch (j.status) {
    case "draft":
      return [{ action: "start", label: "Mulai", cls: "primary" }, cancel];
    case "queued":
    case "running":
      return [{ action: "pause", label: "Jeda" }, cancel];
    case "paused":
      return [{ action: "resume", label: "Lanjutkan", cls: "primary" }, cancel];
    case "completed_with_errors":
      return [{ action: "retry_failed", label: "Coba ulang yang gagal", cls: "primary" }, ...(canRollback ? [rollback] : [])];
    case "completed":
    case "cancelled":
      return canRollback ? [rollback] : [];
    default:
      return [];
  }
}


export default function DashboardClient() {
  return (
    <Shell active="ringkasan">
      <Overview />
    </Shell>
  );
}

function Overview() {
  const { unauthorized } = useShell();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(0);
  const [stale, setStale] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<Record<string, Detail | "loading">>({});
  const [promos, setPromos] = useState<PromosOverview | null>(null);
  const [promosErr, setPromosErr] = useState("");
  const [vouchers, setVouchers] = useState<VouchersOverview | null>(null);
  const [vouchersErr, setVouchersErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/data", { cache: "no-store" });
      if (r.status === 401) return unauthorized();
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError("");
      setStale(false);
      setUpdated(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStale(true);
    }
  }, [unauthorized]);

  const loadCounts = useCallback(
    async (refresh = false) => {
      const q = refresh ? "?refresh=1" : "";
      await Promise.all([
        fetch(`/api/dashboard/promos${q}`, { cache: "no-store" })
          .then(async (r) => {
            if (r.status === 401) return unauthorized();
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
            setPromos(j);
            setPromosErr("");
          })
          .catch((e) => setPromosErr(e instanceof Error ? e.message : String(e))),
        fetch(`/api/dashboard/vouchers${q}`, { cache: "no-store" })
          .then(async (r) => {
            if (r.status === 401) return unauthorized();
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
            setVouchers(j);
            setVouchersErr("");
          })
          .catch((e) => setVouchersErr(e instanceof Error ? e.message : String(e))),
      ]);
    },
    [unauthorized],
  );
  useEffect(() => {
    void loadCounts();
    const t = setInterval(() => { if (!document.hidden) void loadCounts(); }, 180000);
    return () => clearInterval(t);
  }, [loadCounts]);

  const live = (data?.summary.active_jobs ?? 0) > 0;
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!document.hidden) await load();
      if (alive) timer.current = setTimeout(tick, live ? 4000 : 15000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, live]);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) unauthorized();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  async function act(jobId: string | undefined, b: { action: string; label?: string; confirm?: string }) {
    if (b.confirm && !window.confirm(b.confirm)) return;
    setBusy(`${jobId ?? ""}:${b.action}`);
    try {
      await post("/api/dashboard/action", { job_id: jobId, action: b.action });
      say(b.action === "run_worker" ? "Worker dipicu" : `${b.label ?? b.action}: berhasil`);
      await load();
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function toggle(id: string) {
    if (open[id]) {
      setOpen(({ [id]: _drop, ...rest }) => rest);
      return;
    }
    setOpen((o) => ({ ...o, [id]: "loading" }));
    try {
      const r = await fetch(`/api/dashboard/job?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setOpen((o) => ({ ...o, [id]: j }));
    } catch (err) {
      setOpen(({ [id]: _drop, ...rest }) => rest);
      say(err instanceof Error ? err.message : String(err));
    }
  }

  if (!data) return <p className="py-10 text-center text-sm text-gray-500">{error ? `Gagal memuat: ${error}` : "Memuat…"}</p>;

  const d = data;
  const attention = d.shops.filter((s) => s.health === "expiring" || s.health === "expired").length;
  const storeBad = d.server.store === "belum dipasang";

  return (
    <>
      {error && <Note tone="warn">Gagal memuat data terbaru: {error}</Note>}

      <section id="ringkasan" className="scroll-mt-24">
        <PageTitle
          title="Ringkasan"
          sub="Kondisi toko dan antrian saat ini"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{d.server.env === "production" ? "Production" : "Sandbox"}</Badge>
              {d.server.read_only && <Badge tone="warn">Mode baca-saja</Badge>}
              <Badge tone={storeBad ? "bad" : d.server.store === "file" ? "warn" : "mute"}>
                {storeBad ? "Redis belum dipasang" : d.server.store === "file" ? "Penyimpanan: file lokal" : "Redis"}
              </Badge>
              <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <i className={`size-2 rounded-full ${stale ? "bg-warning-500" : "bg-success-500"}`} />
                {updated ? `Diperbarui ${new Date(updated).toLocaleTimeString("id-ID", { timeZone: TZ })}` : ""}
              </span>
              <button className={`${BTN} ${BTN_DEFAULT}`} onClick={() => { void load(); void loadCounts(true); }}>Muat ulang</button>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Toko terhubung" value={d.shops.length} />
          <Stat label="Perlu perhatian" value={attention} tone={attention ? "warn" : undefined} />
          <Stat label="Job aktif" value={d.summary.active_jobs} />
          <Stat label="Produk menunggu" value={d.summary.pending_items} />
          <Stat label="Produk gagal" value={d.summary.failed_items} tone={d.summary.failed_items ? "bad" : undefined} />
        </div>
      </section>

      <section id="toko" className="scroll-mt-24">
        <PageTitle title="Toko terhubung" sub="Masa berlaku izin akses tiap toko, dipisah per marketplace" />
        <div className="space-y-8">
          {(["shopee", "tiktok"] as const).map((pf) => {
            const list = d.shops.filter((x) => x.platform === pf);
            const soon = list.filter((x) => x.health === "expiring" || x.health === "expired").length;
            const canConnect = pf === "shopee" || d.server.tiktok_configured;
            return (
              <div key={pf}>
                <div className="mb-3 flex flex-wrap items-center gap-2.5">
                  <span className={`grid size-8 place-items-center rounded-lg text-xs font-bold text-white ${pf === "shopee" ? "bg-orange-500" : "bg-gray-900 dark:bg-gray-700"}`}>{pf === "shopee" ? "S" : "T"}</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{PLATFORM[pf].label}</h3>
                  <Badge tone="mute">{list.length} toko</Badge>
                  {soon > 0 && <Badge tone="warn">{soon} perlu perhatian</Badge>}
                  <span className="flex-1" />
                  {canConnect && <a className={`${BTN} ${BTN_PRIMARY}`} href={PLATFORM[pf].connect}>+ Hubungkan {PLATFORM[pf].label}</a>}
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((s: Shop) => (
                    <Card key={`${s.platform}:${s.shop_id}`}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{s.shop_name ?? "Toko tanpa nama"}</h3>
                          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{PLATFORM[s.platform].label}{s.region ? ` · region ${s.region}` : ""} · ID {s.shop_id}</span>
                        </div>
                        <span className="flex-1" />
                        <Badge tone={HEALTH[s.health].cls}>{HEALTH[s.health].label}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                        {s.refresh_expire_at ? (
                          <>
                            Izin akses {s.health === "expired" ? "berakhir" : "berakhir pada"} <b className="font-semibold text-gray-800 dark:text-gray-200">{fmtDay(s.refresh_expire_at)}</b>{s.estimated ? " (perkiraan)" : ""}
                            {s.days_left !== null && s.health !== "expired" && <> · <b className="font-semibold text-gray-800 dark:text-gray-200">{s.days_left} hari lagi</b></>}
                            {s.health === "expired" && <> · hubungkan ulang toko ini</>}
                          </>
                        ) : (
                          <>Tanggal berakhir belum tercatat; akan terisi otomatis saat toko dipakai berikutnya.</>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {s.connected_at ? <>Terhubung sejak {fmtDay(s.connected_at)} · </> : null}diperpanjang otomatis setiap toko dipakai
                      </p>
                      {(s.health === "expiring" || s.health === "expired") && (
                        <a className={`${BTN} ${BTN_PRIMARY} mt-4`} href={PLATFORM[s.platform].connect}>Hubungkan ulang</a>
                      )}
                    </Card>
                  ))}
                  {list.length === 0 && (
                    <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700 md:col-span-2 xl:col-span-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Belum ada toko {PLATFORM[pf].label} terhubung.</span>
                      <span className="text-xs text-gray-400">
                        {canConnect ? "Login sebagai seller toko yang dituju." : "TikTok Shop belum dikonfigurasi (isi TIKTOK_APP_KEY dan kawan-kawan di file .env server)."}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="flashsale" className="scroll-mt-24">
        <PageTitle
          title="Flash sale mendatang"
          sub="Jumlah per toko; hitungan tiap toko terpisah"
          action={<a className={`${BTN} ${BTN_DEFAULT}`} href="/dashboard/flash-sale">Lihat detail →</a>}
        />
        {promosErr && <Note tone="warn">Gagal memuat flash sale: {promosErr}</Note>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!promos && !promosErr && <Card><Empty>Memuat flash sale…</Empty></Card>}
          {promos && promos.shops.length === 0 && <Card><Empty>Belum ada toko terhubung.</Empty></Card>}
          {promos?.shops.map((p) => {
            const c = summarizePromos(p.entries);
            return (
              <Card key={`${p.platform}:${p.shop_id}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{PLATFORM[p.platform].label} · ID {p.shop_id}</span>
                  </div>
                  {p.error && <><span className="flex-1" /><Badge tone="bad">Gagal dimuat</Badge></>}
                </div>
                {p.error ? (
                  <p className="mt-3 break-words text-sm text-error-600">{p.error}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-brand-25 p-3 dark:bg-white/5"><div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{c.upcoming}</div><div className="text-xs text-gray-500 dark:text-gray-400">Akan datang</div></div>
                    <div className="rounded-xl bg-success-50 p-3 dark:bg-success-500/10"><div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{c.ongoing}</div><div className="text-xs text-gray-500 dark:text-gray-400">Berlangsung</div></div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section id="voucher" className="scroll-mt-24">
        <PageTitle
          title="Voucher aktif"
          sub="Jumlah per toko Shopee; voucher TikTok Shop belum didukung"
          action={<a className={`${BTN} ${BTN_DEFAULT}`} href="/dashboard/voucher">Lihat detail →</a>}
        />
        {vouchersErr && <Note tone="warn">Gagal memuat voucher: {vouchersErr}</Note>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!vouchers && !vouchersErr && <Card><Empty>Memuat voucher…</Empty></Card>}
          {vouchers && vouchers.shops.length === 0 && <Card><Empty>Belum ada toko Shopee terhubung.</Empty></Card>}
          {vouchers?.shops.map((p) => {
            const c = summarizeVouchers(p.vouchers);
            return (
              <Card key={p.shop_id}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">Shopee · ID {p.shop_id}</span>
                  </div>
                  {p.error && <><span className="flex-1" /><Badge tone="bad">Gagal dimuat</Badge></>}
                </div>
                {p.error ? (
                  <p className="mt-3 break-words text-sm text-error-600">{p.error}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-success-50 p-3 dark:bg-success-500/10"><div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{c.active}{p.truncated ? "+" : ""}</div><div className="text-xs text-gray-500 dark:text-gray-400">Voucher aktif</div></div>
                    <div className="rounded-xl bg-warning-50 p-3 dark:bg-warning-500/10"><div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{c.expiring}</div><div className="text-xs text-gray-500 dark:text-gray-400">Segera berakhir</div></div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section id="antrian" className="scroll-mt-24">
            <PageTitle
              title="Antrian edit massal"
              sub={`Otomatis diperbarui tiap ${live ? "4" : "15"} detik`}
              action={
                d.jobs.some((j) => j.status === "queued" || j.status === "running") ? (
                  <button disabled={busy === ":run_worker"} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => act(undefined, { action: "run_worker", label: "Jalankan worker" })}>Jalankan worker sekarang</button>
                ) : undefined
              }
            />
            <div className="grid gap-4">
              {d.jobs.length === 0 && <Card><Empty>Belum ada job. Minta Claude: “antrekan perubahan judul untuk produk …”.</Empty></Card>}
              {d.jobs.map((j: Job) => {
                const st = STATUS[j.status] ?? { label: j.status, cls: "mute" };
                const done = j.ok + j.failed;
                const pctOk = j.total ? (j.ok / j.total) * 100 : 0;
                const pctBad = j.total ? (j.failed / j.total) * 100 : 0;
                const detail = open[j.job_id];
                return (
                  <Card key={j.job_id}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">{j.label || j.job_id}</span>
                      <Badge tone={st.cls}>{st.label}</Badge>
                      <Badge tone="mute">{PLATFORM[j.platform]?.label ?? j.platform}</Badge>
                      {j.kind === "rollback" && <Badge tone="mute">rollback</Badge>}
                      <span className="flex-1" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{j.shop_name ?? `Toko ${j.shop_id}`} · {fmt(Date.parse(j.created_at))}</span>
                    </div>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={j.total}>
                      <i className={`block h-full bg-success-500 ${j.status === "running" ? "animate-shine" : ""}`} style={{ width: `${pctOk}%` }} />
                      <i className="block h-full bg-error-500" style={{ width: `${pctBad}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                      <span><b className="font-semibold text-gray-800 tabular-nums dark:text-gray-200">{done}</b> / {j.total} diproses ({j.total ? Math.round((done / j.total) * 100) : 0}%)</span>
                      <span><b className="font-semibold text-success-600 tabular-nums">{j.ok}</b> berhasil</span>
                      <span><b className={`font-semibold tabular-nums ${j.failed ? "text-error-600" : "text-gray-800 dark:text-gray-200"}`}>{j.failed}</b> gagal</span>
                      <span><b className="font-semibold text-gray-800 tabular-nums dark:text-gray-200">{j.pending}</b> menunggu</span>
                      {j.pending > 0 && (j.status === "running" || j.status === "queued") && <span>± <b className="font-semibold text-gray-800 dark:text-gray-200">{Math.max(1, Math.ceil(j.pending / (j.per_minute || 90)))}</b> menit lagi</span>}
                      <span className="ml-auto font-mono text-xs text-gray-400">{j.job_id}</span>
                    </div>
                    {j.status === "paused" && (
                      <Note tone="warn">Job dijeda{j.pause_reason ? <>: {j.pause_reason}</> : null}. Perbaiki penyebabnya, lalu klik Lanjutkan.</Note>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {buttonsFor(j).map((b) => (
                        <button key={b.action} className={`${BTN} ${b.cls === "primary" ? BTN_PRIMARY : b.cls === "danger" ? BTN_DANGER : BTN_DEFAULT}`} disabled={busy === `${j.job_id}:${b.action}`} onClick={() => act(j.job_id, b)}>{b.label}</button>
                      ))}
                      <button className="px-2 text-sm font-medium text-brand-500 hover:underline" onClick={() => toggle(j.job_id)}>{detail ? "Sembunyikan detail" : "Lihat detail"}</button>
                    </div>
                    {detail === "loading" && <p className="mt-3 text-sm text-gray-500">Memuat detail…</p>}
                    {detail && detail !== "loading" && <DetailView d={detail} />}
                  </Card>
                );
              })}
            </div>
          </section>
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-theme-md dark:bg-white dark:text-gray-900">{toast}</div>}
    </>
  );
}

function DetailView({ d }: { d: Detail }) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
      {d.pause_reason && <Note tone="warn">Alasan jeda: {d.pause_reason}</Note>}
      {d.last_error && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Error terakhir: {d.last_error}</p>}
      {d.finished_at && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Selesai: {fmt(Date.parse(d.finished_at))}</p>}
      {d.failures_sample.length ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-white/5 dark:text-gray-400">
              <tr><th className="px-4 py-2.5 font-medium">ID produk</th><th className="px-4 py-2.5 font-medium">Alasan gagal</th><th className="px-4 py-2.5 font-medium">Percobaan</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {d.failures_sample.map((f) => (
                <tr key={f.item_id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{f.item_id}</td>
                  <td className="px-4 py-2.5">{f.error ?? "-"}</td>
                  <td className="px-4 py-2.5">{f.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Tidak ada produk gagal.</p>
      )}
    </div>
  );
}
