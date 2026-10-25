"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Overview } from "@/lib/dashboard";
import type { PromosOverview } from "@/lib/promos";
import type { VouchersOverview } from "@/lib/vouchers";

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
  const [promos, setPromos] = useState<PromosOverview | null>(null);
  const [promosErr, setPromosErr] = useState("");
  const [promosBusy, setPromosBusy] = useState(false);
  const [vouchers, setVouchers] = useState<VouchersOverview | null>(null);
  const [vouchersErr, setVouchersErr] = useState("");
  const [vouchersBusy, setVouchersBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const [menu, setMenu] = useState(false);
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

  const loadPromos = useCallback(async (refresh = false) => {
    setPromosBusy(true);
    try {
      const r = await fetch(`/api/dashboard/promos${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPromos(j);
      setPromosErr("");
    } catch (e) {
      setPromosErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPromosBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!authed) return;
    void loadPromos();
    const t = setInterval(() => { if (!document.hidden) void loadPromos(); }, 180000);
    return () => clearInterval(t);
  }, [authed, loadPromos]);

  const loadVouchers = useCallback(async (refresh = false) => {
    setVouchersBusy(true);
    try {
      const r = await fetch(`/api/dashboard/vouchers${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setVouchers(j);
      setVouchersErr("");
    } catch (e) {
      setVouchersErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVouchersBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!authed) return;
    void loadVouchers();
    const t = setInterval(() => { if (!document.hidden) void loadVouchers(); }, 180000);
    return () => clearInterval(t);
  }, [authed, loadVouchers]);

  useEffect(() => {
    let d = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    try {
      const t = localStorage.getItem("da_theme");
      if (t) d = t === "dark";
    } catch {}
    setDark(d);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const toggleTheme = () => {
    setDark((v) => {
      try { localStorage.setItem("da_theme", v ? "light" : "dark"); } catch {}
      return !v;
    });
  };

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
      await post("/api/dashboard/login", { password: key });
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


  if (authed === null) return <div className="grid min-h-screen place-items-center text-sm text-gray-500">Memuat…</div>;

  if (!authed) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Delova Agent</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Masuk ke dashboard</p>
            </div>
          </div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Masukkan password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 shadow-theme-xs outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white"
          />
          <p className="mt-2 min-h-5 text-sm text-error-600">{loginErr}</p>
          <button type="submit" disabled={!key} className={`${BTN} ${BTN_PRIMARY} mt-2 h-11 w-full`}>Masuk</button>
        </form>
      </div>
    );
  }

  const d = data!;
  const attention = d.shops.filter((s) => s.health === "expiring" || s.health === "expired").length;
  const storeBad = d.server.store === "belum dipasang";
  const nav = [
    { id: "ringkasan", label: "Ringkasan", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
    { id: "toko", label: "Toko terhubung", icon: "M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6" },
    { id: "flashsale", label: "Flash sale", icon: "M13 2L4 14h7l-1 8 9-12h-7l1-8z" },
    { id: "voucher", label: "Voucher aktif", icon: "M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8zM13 6v12" },
    { id: "antrian", label: "Antrian edit massal", icon: "M4 6h16M4 12h16M4 18h10" },
  ];

  return (
    <div className="min-h-screen">
      {menu && <div className="fixed inset-0 z-30 bg-gray-900/50 lg:hidden" onClick={() => setMenu(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white px-5 py-6 transition-transform dark:border-gray-800 dark:bg-gray-900 lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-8 flex items-center gap-3 px-1">
          <Logo />
          <div className="leading-tight">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">Delova Agent</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Shopee &amp; TikTok Shop</div>
          </div>
        </div>
        <div className="mb-3 px-3 text-xs font-medium uppercase tracking-wider text-gray-400">Menu</div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={() => setMenu(false)} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-500 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-brand-400">
              <svg className="size-5 shrink-0 text-gray-500 group-hover:text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-gray-50 p-4 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
          Ubah produk, flash sale, dan antrian paling mudah lewat chat Claude. Dashboard ini untuk memantau.
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90 sm:px-6">
          <button className="grid size-10 place-items-center rounded-lg border border-gray-200 text-gray-600 lg:hidden dark:border-gray-700 dark:text-gray-300" onClick={() => setMenu(true)} aria-label="Buka menu">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Badge tone="info">{d.server.env === "production" ? "Production" : "Sandbox"}</Badge>
          {d.server.read_only && <Badge tone="warn">Mode baca-saja</Badge>}
          <Badge tone={storeBad ? "bad" : d.server.store === "file" ? "warn" : "mute"}>
            {storeBad ? "Redis belum dipasang" : d.server.store === "file" ? "Penyimpanan: file lokal" : "Redis"}
          </Badge>
          <span className="flex-1" />
          <span className="hidden items-center gap-2 text-xs text-gray-500 sm:flex dark:text-gray-400">
            <i className={`size-2 rounded-full ${stale ? "bg-warning-500" : "bg-success-500"}`} />
            {updated ? `Diperbarui ${new Date(updated).toLocaleTimeString("id-ID", { timeZone: TZ })}` : ""}
          </span>
          <button className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load()}>Muat ulang</button>
          <button className="grid size-10 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5" onClick={toggleTheme} aria-label="Ganti tema" title={dark ? "Mode terang" : "Mode gelap"}>
            {dark ? (
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
            )}
          </button>
          <button className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white" onClick={logout}>Keluar</button>
        </header>

        <main className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
          {error && <Note tone="warn">Gagal memuat data terbaru: {error}</Note>}

          <section id="ringkasan" className="scroll-mt-24">
            <PageTitle title="Ringkasan" sub="Kondisi toko dan antrian saat ini" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Stat label="Toko terhubung" value={d.shops.length} />
              <Stat label="Perlu perhatian" value={attention} tone={attention ? "warn" : undefined} />
              <Stat label="Job aktif" value={d.summary.active_jobs} />
              <Stat label="Produk menunggu" value={d.summary.pending_items} />
              <Stat label="Produk gagal" value={d.summary.failed_items} tone={d.summary.failed_items ? "bad" : undefined} />
            </div>
          </section>

          <section id="toko" className="scroll-mt-24">
            <PageTitle title="Toko terhubung" sub="Masa berlaku izin akses tiap toko" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {d.shops.map((s: Shop) => (
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
              <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
                {d.shops.length === 0 && <span className="text-sm text-gray-500 dark:text-gray-400">Belum ada toko terhubung.</span>}
                <div className="flex flex-wrap justify-center gap-2">
                  <a className={`${BTN} ${BTN_PRIMARY}`} href="/api/shopee/connect">+ Hubungkan Shopee</a>
                  {d.server.tiktok_configured && <a className={`${BTN} ${BTN_PRIMARY}`} href="/api/tiktok/connect">+ Hubungkan TikTok Shop</a>}
                </div>
                <span className="text-xs text-gray-400">
                  Login sebagai seller toko yang dituju{d.server.tiktok_configured ? "" : " · TikTok Shop belum dikonfigurasi (isi TIKTOK_APP_KEY dan kawan-kawan di file .env server)"}
                </span>
              </div>
            </div>
          </section>

          <section id="flashsale" className="scroll-mt-24">
            <PageTitle
              title="Flash sale mendatang"
              sub={`Yang akan datang dan sedang berlangsung di tiap toko${promos ? ` · dicek ${new Date(promos.generated_at).toLocaleTimeString("id-ID", { timeZone: TZ })}` : ""}`}
              action={<button disabled={promosBusy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => loadPromos(true)}>{promosBusy ? "Memuat…" : "Muat ulang flash sale"}</button>}
            />
            {promosErr && <Note tone="warn">Gagal memuat flash sale: {promosErr}</Note>}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {!promos && !promosErr && <Card><Empty>Memuat flash sale…</Empty></Card>}
              {promos && promos.shops.length === 0 && <Card><Empty>Belum ada toko terhubung.</Empty></Card>}
              {promos?.shops.map((p) => (
                <Card key={`${p.platform}:${p.shop_id}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{PLATFORM[p.platform].label} · ID {p.shop_id}</span>
                    </div>
                    <span className="flex-1" />
                    <Badge tone={p.error ? "bad" : p.entries.length ? "info" : "mute"}>{p.error ? "Gagal dimuat" : `${p.entries.length} jadwal`}</Badge>
                  </div>
                  {p.error && <p className="mt-3 break-words text-sm text-error-600">{p.error}</p>}
                  {!p.error && p.entries.length === 0 && <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Tidak ada flash sale terjadwal. Minta Claude: “buat flash sale …”.</p>}
                  <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {p.entries.map((e) => (
                      <li key={`${e.status}:${e.id}`} className="py-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={e.status === "ongoing" ? "ok" : "info"}>{e.status === "ongoing" ? "Berlangsung" : "Akan datang"}</Badge>
                          <b className="font-semibold text-gray-800 dark:text-gray-200">{e.start ? fmt(e.start * 1000) : "waktu belum diketahui"}</b>
                        </div>
                        <div className="mt-1 text-gray-500 dark:text-gray-400">
                          {e.end ? <>sampai {fmt(e.end * 1000)}</> : null}
                          {e.title ? <> · {e.title}</> : null}
                          {e.product_count !== null ? <> · {e.product_count} produk</> : null}
                          <span className="font-mono text-xs text-gray-400"> · ID {e.id}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </section>

          <section id="voucher" className="scroll-mt-24">
            <PageTitle
              title="Voucher aktif"
              sub={`Voucher Shopee yang sedang berlaku${vouchers ? ` · dicek ${new Date(vouchers.generated_at).toLocaleTimeString("id-ID", { timeZone: TZ })}` : ""} · voucher TikTok Shop belum didukung`}
              action={<button disabled={vouchersBusy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => loadVouchers(true)}>{vouchersBusy ? "Memuat…" : "Muat ulang voucher"}</button>}
            />
            {vouchersErr && <Note tone="warn">Gagal memuat voucher: {vouchersErr}</Note>}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {!vouchers && !vouchersErr && <Card><Empty>Memuat voucher…</Empty></Card>}
              {vouchers && vouchers.shops.length === 0 && <Card><Empty>Belum ada toko Shopee terhubung.</Empty></Card>}
              {vouchers?.shops.map((p) => (
                <Card key={p.shop_id}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">Shopee · ID {p.shop_id}</span>
                    </div>
                    <span className="flex-1" />
                    <Badge tone={p.error ? "bad" : p.vouchers.length ? "ok" : "mute"}>{p.error ? "Gagal dimuat" : `${p.vouchers.length} aktif${p.truncated ? "+" : ""}`}</Badge>
                  </div>
                  {p.error && <p className="mt-3 break-words text-sm text-error-600">{p.error}</p>}
                  {!p.error && p.vouchers.length === 0 && <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Tidak ada voucher aktif.</p>}
                  <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {p.vouchers.map((v) => {
                      const soon = v.end !== null && v.end * 1000 - Date.now() < 3 * 86400000;
                      const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
                      const reward = v.amount === null ? null : v.reward === "persen" ? `${v.amount}%` : v.reward === "koin" ? `${v.amount} koin` : rp(v.amount);
                      const pct = v.quota ? Math.min(100, Math.round(((v.used ?? 0) / v.quota) * 100)) : null;
                      return (
                        <li key={v.id} className="py-2.5 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <b className="font-semibold text-gray-800 dark:text-gray-200">{v.name ?? v.code ?? `Voucher ${v.id}`}</b>
                            {reward && <Badge tone="ok">Diskon {reward}</Badge>}
                            {soon && <Badge tone="warn">Segera berakhir</Badge>}
                          </div>
                          <div className="mt-1 text-gray-500 dark:text-gray-400">
                            {v.code ? <>kode <b className="font-semibold text-gray-700 dark:text-gray-300">{v.code}</b> · </> : null}
                            {v.scope ? <>voucher {v.scope} · </> : null}
                            {v.min_spend ? <>min. belanja {rp(v.min_spend)} · </> : null}
                            {v.end ? <>sampai {fmt(v.end * 1000)}</> : null}
                            <span className="font-mono text-xs text-gray-400"> · ID {v.id}</span>
                          </div>
                          {pct !== null && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><i className="block h-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                              <span className="text-xs text-gray-500 tabular-nums dark:text-gray-400">{v.used ?? 0}/{v.quota}</span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
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
        </main>
      </div>
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-theme-md dark:bg-white dark:text-gray-900">{toast}</div>}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "mute";
const BTN = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-default disabled:opacity-50";
const BTN_PRIMARY = "bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600";
const BTN_DEFAULT = "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/5";
const BTN_DANGER = "bg-white text-error-600 ring-1 ring-inset ring-error-500/40 hover:bg-error-50 dark:bg-gray-800 dark:hover:bg-error-500/10";
const TONE: Record<Tone, string> = {
  ok: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  warn: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500",
  bad: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
  info: "bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400",
  mute: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[(tone as Tone) in TONE ? (tone as Tone) : "mute"]}`}>{children}</span>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}
function Note({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return <div className={`mt-3 rounded-lg px-4 py-2.5 text-sm ${TONE[tone]}`}>{children}</div>;
}
function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
        {sub && <p className="text-sm text-gray-500 dark:text-gray-400">{sub}</p>}
      </div>
      <span className="flex-1" />
      {action}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  const color = tone === "warn" ? "text-warning-600" : tone === "bad" ? "text-error-600" : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
function Logo() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-brand-500 text-lg font-bold text-white">D</div>
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
