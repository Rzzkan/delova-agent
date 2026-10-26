"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dayKey, monthCells, monthStats, scheduleByDay } from "@/lib/calendar";
import type { PromoEntry, PromosOverview, ShopPromos } from "@/lib/promos";
import Shell, { useShell } from "../Shell";
import { BTN, BTN_DEFAULT, Badge, Card, Empty, Note, PLATFORM, PageTitle, fmt, fmtTime } from "../ui";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const WEEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const hm = (sec: number) => new Date(sec * 1000).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

export default function CalendarClient() {
  return (
    <Shell active="kalender">
      <Page />
    </Shell>
  );
}

function Page() {
  const { unauthorized } = useShell();
  const [data, setData] = useState<PromosOverview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<"shopee" | "tiktok">("shopee");
  const todayKey = dayKey(Date.now() / 1000);
  const [ym, setYm] = useState(() => ({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) - 1 }));

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      try {
        const r = await fetch(`/api/dashboard/promos${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
        if (r.status === 401) return unauthorized();
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setData(j);
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [unauthorized],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const shift = (d: number) =>
    setYm(({ y, m }) => {
      const n = y * 12 + m + d;
      return { y: Math.floor(n / 12), m: n % 12 };
    });
  const shops = (data?.shops ?? []).filter((s) => s.platform === platform);
  const counts = { shopee: data?.shops.filter((s) => s.platform === "shopee").length ?? 0, tiktok: data?.shops.filter((s) => s.platform === "tiktok").length ?? 0 };

  return (
    <>
      <PageTitle
        title="Kalender flash sale"
        sub={`Tanggal yang sudah dan belum dijadwalkan, per akun toko${data ? ` · dicek ${fmtTime(data.generated_at)}` : ""}`}
        action={<button disabled={busy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load(true)}>{busy ? "Memuat…" : "Muat ulang"}</button>}
      />
      <div className="-mt-1 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-white/5">
          {(["shopee", "tiktok"] as const).map((p) => (
            <button key={p} onClick={() => setPlatform(p)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${platform === p ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>
              {PLATFORM[p].label} <span className="ml-1 text-xs text-gray-400">{counts[p]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className={`${BTN} ${BTN_DEFAULT} !px-3`} onClick={() => shift(-1)} aria-label="Bulan sebelumnya">←</button>
          <span className="min-w-36 text-center text-sm font-semibold text-gray-900 dark:text-white">{MONTHS[ym.m]} {ym.y}</span>
          <button className={`${BTN} ${BTN_DEFAULT} !px-3`} onClick={() => shift(1)} aria-label="Bulan berikutnya">→</button>
          <button className={`${BTN} ${BTN_DEFAULT} ml-2`} onClick={() => setYm({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) - 1 })}>Hari ini</button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-brand-500" /> Terjadwal</span>
          <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-success-500" /> Berlangsung hari ini</span>
          <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-dashed border-gray-400" /> Belum dijadwalkan</span>
        </div>
      </div>
      {err && <Note tone="warn">Gagal memuat data flash sale: {err}</Note>}
      {!data && !err && <Card><Empty>Memuat kalender…</Empty></Card>}
      {data && shops.length === 0 && (
        <Card><Empty>{platform === "tiktok" ? "Belum ada toko TikTok Shop terhubung (atau TikTok belum dikonfigurasi)." : "Belum ada toko Shopee terhubung."}</Empty></Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {shops.map((s) => (
          <ShopCalendar key={`${s.platform}:${s.shop_id}`} shop={s} y={ym.y} m={ym.m} todayKey={todayKey} />
        ))}
      </div>
      <p className="text-xs text-gray-400">
        Menampilkan flash sale yang akan datang dan sedang berlangsung dari API toko (Shopee: sekitar 60 hari ke depan). Hari yang sudah lewat tidak dihitung sebagai “belum dijadwalkan”. Zona waktu WIB.
      </p>
    </>
  );
}

function ShopCalendar({ shop, y, m, todayKey }: { shop: ShopPromos; y: number; m: number; todayKey: string }) {
  const map = useMemo(() => scheduleByDay(shop.entries), [shop.entries]);
  const cells = useMemo(() => monthCells(y, m), [y, m]);
  const st = monthStats(map, y, m, todayKey);
  const [sel, setSel] = useState<string | null>(null);
  const chosen = sel && map.get(sel);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{shop.shop_name ?? "Toko tanpa nama"}</h3>
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{PLATFORM[shop.platform].label} · ID {shop.shop_id}</span>
        </div>
        <span className="flex-1" />
        {shop.error ? (
          <Badge tone="bad">Gagal dimuat</Badge>
        ) : (
          <>
            <Badge tone="info">{st.scheduled} hari terjadwal</Badge>
            <Badge tone={st.free ? "warn" : "ok"}>{st.free} hari belum</Badge>
          </>
        )}
      </div>
      {shop.error && <p className="break-words px-5 py-4 text-sm text-error-600">{shop.error}</p>}
      <div className="p-4">
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-gray-400">
          {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((c) => {
            if (!c.inMonth) return <div key={c.key} />;
            const list = map.get(c.key);
            const past = c.key < todayKey;
            const today = c.key === todayKey;
            const live = !!list?.some((e) => e.status === "ongoing") && today;
            let cls = "border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5";
            if (list) cls = live ? "bg-success-500 text-white" : past ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" : "bg-brand-500 text-white hover:bg-brand-600";
            else if (past) cls = "border border-transparent text-gray-300 dark:text-gray-600";
            return (
              <button
                key={c.key}
                disabled={!list}
                onClick={() => setSel(sel === c.key ? null : c.key)}
                title={list ? `${list.length} flash sale` : past ? "" : "Belum dijadwalkan"}
                className={`relative aspect-[5/4] rounded-lg text-sm font-medium tabular-nums ${cls} ${today ? "ring-2 ring-brand-300 ring-offset-1 dark:ring-offset-gray-900" : ""} ${sel === c.key ? "outline-2 outline-offset-1 outline-gray-900 dark:outline-white" : ""}`}
              >
                {c.day}
                {list && list.length > 1 && <span className="absolute right-1 top-0.5 text-[10px] leading-none opacity-80">×{list.length}</span>}
              </button>
            );
          })}
        </div>
        {chosen && sel && (
          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-800">
            {chosen.map((e: PromoEntry) => (
              <li key={`${e.status}:${e.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Badge tone={e.status === "ongoing" ? "ok" : "info"}>{e.status === "ongoing" ? "Berlangsung" : "Akan datang"}</Badge>
                <span className="text-gray-800 dark:text-gray-200">{e.start ? fmt(e.start * 1000) : "-"}{e.end ? ` – ${hm(e.end)}` : ""}</span>
                {e.title && <span className="text-gray-500">· {e.title}</span>}
                {e.product_count !== null && <span className="text-gray-500">· {e.product_count} produk</span>}
                <span className="ml-auto font-mono text-xs text-gray-400">ID {e.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
