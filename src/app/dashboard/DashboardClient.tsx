"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Overview } from "@/lib/dashboard";

type Job = Overview["jobs"][number];
type Shop = Overview["shops"][number];
type Detail = {
  failures_sample: { item_id: number | string; error?: string; attempts: number }[];
  pause_reason?: string;
  last_error?: string;
  eta_minutes: number;
  finished_at?: string;
};

const TZ = "Asia/Jakarta";
const fmt = (ms: number) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString("id-ID", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "mute" },
  queued: { label: "Antri", cls: "info" },
  running: { label: "Berjalan", cls: "info" },
  paused: { label: "Dijeda", cls: "warn" },
  cancelled: { label: "Dibatalkan", cls: "mute" },
  completed: { label: "Selesai", cls: "ok" },
  completed_with_errors: { label: "Selesai, ada yang gagal", cls: "warn" },
};
const PLATFORM: Record<string, { label: string; connect: string }> = {
  shopee: { label: "Shopee", connect: "/api/shopee/connect" },
  tiktok: { label: "TikTok Shop", connect: "/api/tiktok/connect" },
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
  const [data, setData] = useState<Overview | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(0);
  const [stale, setStale] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<Record<string, Detail | "loading">>({});
  const [key, setKey] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/data", { cache: "no-store" });
      if (r.status === 401) {
        setAuthed(false);
        setData(null);
        return;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setAuthed(true);
      setError("");
      setStale(false);
      setUpdated(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStale(true);
    }
  }, []);

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
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr("");
    try {
      await post("/api/dashboard/login", { key });
      setKey("");
      await load();
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : String(err));
    }
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

  async function logout() {
    await post("/api/dashboard/logout", {}).catch(() => {});
    setAuthed(false);
    setData(null);
  }

  if (authed === null) return <div className="wrap"><p className="empty">Memuat…</p></div>;

  if (!authed) {
    return (
      <form className="login card" onSubmit={login}>
        <h1>Delova Agent</h1>
        <p>Masukkan kunci akses (MCP_SECRET) untuk membuka dashboard.</p>
        <input type="password" autoFocus autoComplete="current-password" placeholder="Kunci akses" value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="err">{loginErr}</div>
        <button className="primary" type="submit" disabled={!key}>Masuk</button>
      </form>
    );
  }

  const d = data!;
  const attention = d.shops.filter((s) => s.health === "expiring" || s.health === "expired").length;
  const storeBad = d.server.store === "belum dipasang";

  return (
    <div className="wrap">
      <div className="top">
        <h1>Delova Agent</h1>
        <span className={`badge`}>{d.server.env === "production" ? "Production" : "Sandbox"}</span>
        {d.server.read_only && <span className="pill warn">Mode baca-saja</span>}
        <span className={`pill ${storeBad ? "bad" : d.server.store === "file" ? "warn" : "mute"}`} title="Penyimpanan token & antrian">
          {storeBad ? "Redis belum dipasang" : d.server.store === "file" ? "Penyimpanan: file lokal" : "Redis"}
        </span>
        <span className="spacer" />
        <span className="meta" style={{ margin: 0 }}>
          <i className={`dot ${stale ? "stale" : ""}`} /> {updated ? `Diperbarui ${new Date(updated).toLocaleTimeString("id-ID", { timeZone: TZ })}` : ""}
        </span>
        <button onClick={() => load()}>Muat ulang</button>
        <button className="link" onClick={logout}>Keluar</button>
      </div>
      {error && <div className="note">Gagal memuat data terbaru: {error}</div>}

      <div className="stats" style={{ marginTop: 14 }}>
        <div className="card stat"><b>{d.shops.length}</b><span>toko terhubung</span></div>
        <div className="card stat"><b style={{ color: attention ? "var(--warn)" : undefined }}>{attention}</b><span>toko perlu perhatian</span></div>
        <div className="card stat"><b>{d.summary.active_jobs}</b><span>job aktif</span></div>
        <div className="card stat"><b>{d.summary.pending_items}</b><span>produk menunggu</span></div>
        <div className="card stat"><b style={{ color: d.summary.failed_items ? "var(--bad)" : undefined }}>{d.summary.failed_items}</b><span>produk gagal</span></div>
      </div>

      <h2>Toko terhubung</h2>
      <div className="shops">
        {d.shops.map((s: Shop) => (
          <div className="card shop" key={`${s.platform}:${s.shop_id}`}>
            <div className="row">
              <div>
                <h3>{s.shop_name ?? "Toko tanpa nama"}</h3>
                <span className="id">{PLATFORM[s.platform].label}{s.region ? ` · region ${s.region}` : ""} · ID {s.shop_id}</span>
              </div>
              <span className="spacer" />
              <span className={`pill ${HEALTH[s.health].cls}`}>{HEALTH[s.health].label}</span>
            </div>
            <div className="meta">
              {s.refresh_expire_at ? (
                <>
                  Izin akses {s.health === "expired" ? "berakhir" : "berakhir pada"} <b>{fmtDay(s.refresh_expire_at)}</b>{s.estimated ? " (perkiraan)" : ""}
                  {s.days_left !== null && s.health !== "expired" && <> · <b>{s.days_left} hari lagi</b></>}
                  {s.health === "expired" && <> · hubungkan ulang toko ini</>}
                </>
              ) : (
                <>Tanggal berakhir belum tercatat; akan terisi otomatis saat toko dipakai berikutnya.</>
              )}
            </div>
            <div className="meta">
              {s.connected_at ? <>Terhubung sejak {fmtDay(s.connected_at)} · </> : null}diperpanjang otomatis setiap toko dipakai
            </div>
            {(s.health === "expiring" || s.health === "expired") && (
              <div className="actions"><a className="btn primary" href={PLATFORM[s.platform].connect}>Hubungkan ulang</a></div>
            )}
          </div>
        ))}
        <div className="card empty" style={{ display: "grid", placeItems: "center", gap: 8 }}>
          {d.shops.length === 0 && <span>Belum ada toko terhubung.</span>}
          <div className="actions" style={{ justifyContent: "center" }}>
            <a className="btn primary" href="/api/shopee/connect">+ Hubungkan Shopee</a>
            {d.server.tiktok_configured && <a className="btn primary" href="/api/tiktok/connect">+ Hubungkan TikTok Shop</a>}
          </div>
          <span className="meta" style={{ margin: 0 }}>
            Login sebagai seller toko yang dituju{d.server.tiktok_configured ? "" : " · TikTok Shop belum dikonfigurasi (isi TIKTOK_APP_KEY dan kawan-kawan di Vercel)"}
          </span>
        </div>
      </div>

      <h2>Antrian edit massal</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="meta" style={{ margin: 0 }}>Otomatis diperbarui tiap {live ? "4" : "15"} detik</span>
        <span className="spacer" />
        {d.jobs.some((j) => j.status === "queued" || j.status === "running") && (
          <button disabled={busy === ":run_worker"} onClick={() => act(undefined, { action: "run_worker", label: "Jalankan worker" })}>Jalankan worker sekarang</button>
        )}
      </div>
      <div className="jobs">
        {d.jobs.length === 0 && <div className="card empty">Belum ada job. Minta Claude: “antrekan perubahan judul untuk produk …”.</div>}
        {d.jobs.map((j: Job) => {
          const st = STATUS[j.status] ?? { label: j.status, cls: "mute" };
          const done = j.ok + j.failed;
          const pctOk = j.total ? (j.ok / j.total) * 100 : 0;
          const pctBad = j.total ? (j.failed / j.total) * 100 : 0;
          const detail = open[j.job_id];
          return (
            <div className="card job" key={j.job_id}>
              <div className="head">
                <span className="title">{j.label || j.job_id}</span>
                <span className={`pill ${st.cls}`}>{st.label}</span>
                <span className="pill mute">{PLATFORM[j.platform]?.label ?? j.platform}</span>
                {j.kind === "rollback" && <span className="pill mute">rollback</span>}
                <span className="spacer" />
                <span className="meta" style={{ margin: 0 }}>{j.shop_name ?? `Toko ${j.shop_id}`} · {fmt(Date.parse(j.created_at))}</span>
              </div>
              <div className={`bar ${j.status === "running" ? "live" : ""}`} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={j.total}>
                <i className="okb" style={{ width: `${pctOk}%` }} />
                <i className="badb" style={{ width: `${pctBad}%` }} />
              </div>
              <div className="counts">
                <span><b>{done}</b> / {j.total} diproses ({j.total ? Math.round((done / j.total) * 100) : 0}%)</span>
                <span><b style={{ color: "var(--ok)" }}>{j.ok}</b> berhasil</span>
                <span><b style={{ color: j.failed ? "var(--bad)" : undefined }}>{j.failed}</b> gagal</span>
                <span><b>{j.pending}</b> menunggu</span>
                {j.pending > 0 && (j.status === "running" || j.status === "queued") && <span>± <b>{Math.max(1, Math.ceil(j.pending / (j.per_minute || 90)))}</b> menit lagi</span>}
                <span className="id" style={{ marginLeft: "auto" }}>{j.job_id}</span>
              </div>
              {j.status === "paused" && (
                <div className="note">
                  Job dijeda{j.pause_reason ? <>: {j.pause_reason}</> : null}. Perbaiki penyebabnya, lalu klik Lanjutkan.
                </div>
              )}
              <div className="actions">
                {buttonsFor(j).map((b) => (
                  <button key={b.action} className={b.cls} disabled={busy === `${j.job_id}:${b.action}`} onClick={() => act(j.job_id, b)}>{b.label}</button>
                ))}
                <button className="link" onClick={() => toggle(j.job_id)}>{detail ? "Sembunyikan detail" : "Lihat detail"}</button>
              </div>
              {detail === "loading" && <p className="meta">Memuat detail…</p>}
              {detail && detail !== "loading" && <DetailView d={detail} />}
            </div>
          );
        })}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function DetailView({ d }: { d: Detail }) {
  return (
    <div style={{ marginTop: 10 }}>
      {d.pause_reason && <div className="note">Alasan jeda: {d.pause_reason}</div>}
      {d.last_error && <p className="meta">Error terakhir: {d.last_error}</p>}
      {d.finished_at && <p className="meta">Selesai: {fmt(Date.parse(d.finished_at))}</p>}
      {d.failures_sample.length ? (
        <table>
          <thead><tr><th>ID produk</th><th>Alasan gagal</th><th>Percobaan</th></tr></thead>
          <tbody>
            {d.failures_sample.map((f) => (
              <tr key={f.item_id}><td className="id">{f.item_id}</td><td>{f.error ?? "-"}</td><td>{f.attempts}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="meta">Tidak ada produk gagal.</p>
      )}
    </div>
  );
}
