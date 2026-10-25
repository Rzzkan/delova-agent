"use client";

import { useCallback, useEffect, useState } from "react";
import type { PromosOverview } from "@/lib/promos";
import { summarizePromos } from "@/lib/summary";
import Shell, { useShell } from "../Shell";
import { BTN, BTN_DEFAULT, Badge, Card, Empty, Note, PLATFORM, PageTitle, fmt, fmtTime } from "../ui";

type Filter = "all" | "upcoming" | "ongoing";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "upcoming", label: "Akan datang" },
  { id: "ongoing", label: "Berlangsung" },
];
const selectCls = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";

export default function FlashSaleClient() {
  return (
    <Shell active="flashsale">
      <Page />
    </Shell>
  );
}

function Page() {
  const { unauthorized } = useShell();
  const [data, setData] = useState<PromosOverview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [shop, setShop] = useState("all");

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

  const key = (p: { platform: string; shop_id: string }) => `${p.platform}:${p.shop_id}`;
  const shops = (data?.shops ?? []).filter((p) => shop === "all" || key(p) === shop);

  return (
    <>
      <PageTitle
        title="Flash sale"
        sub={`Jadwal flash sale tiap toko${data ? ` · dicek ${fmtTime(data.generated_at)}` : ""}`}
        action={<button disabled={busy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load(true)}>{busy ? "Memuat…" : "Muat ulang"}</button>}
      />
      <div className="-mt-1 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-white/5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f.id ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>{f.label}</button>
          ))}
        </div>
        <select className={selectCls} value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Pilih toko">
          <option value="all">Semua toko</option>
          {data?.shops.map((p) => <option key={key(p)} value={key(p)}>{p.shop_name ?? p.shop_id} ({PLATFORM[p.platform].label})</option>)}
        </select>
      </div>
      {err && <Note tone="warn">Gagal memuat flash sale: {err}</Note>}
      {!data && !err && <Card><Empty>Memuat flash sale…</Empty></Card>}
      {data && data.shops.length === 0 && <Card><Empty>Belum ada toko terhubung.</Empty></Card>}
      {shops.map((p) => {
        const c = summarizePromos(p.entries);
        const rows = p.entries.filter((e) => filter === "all" || e.status === filter);
        return (
          <section key={key(p)} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{PLATFORM[p.platform].label} · ID {p.shop_id}</span>
              </div>
              <span className="flex-1" />
              {p.error ? <Badge tone="bad">Gagal dimuat</Badge> : <><Badge tone="info">{c.upcoming} akan datang</Badge><Badge tone="ok">{c.ongoing} berlangsung</Badge></>}
            </div>
            {p.error ? (
              <p className="break-words px-5 py-4 text-sm text-error-600">{p.error}</p>
            ) : rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Tidak ada flash sale{filter === "all" ? " terjadwal" : " pada filter ini"}. Minta Claude: “buat flash sale …”.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-white/5 dark:text-gray-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Mulai</th>
                      <th className="px-5 py-3 font-medium">Selesai</th>
                      <th className="px-5 py-3 font-medium">Judul</th>
                      <th className="px-5 py-3 text-right font-medium">Produk</th>
                      <th className="px-5 py-3 font-medium">ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map((e) => (
                      <tr key={`${e.status}:${e.id}`}>
                        <td className="px-5 py-3"><Badge tone={e.status === "ongoing" ? "ok" : "info"}>{e.status === "ongoing" ? "Berlangsung" : "Akan datang"}</Badge></td>
                        <td className="whitespace-nowrap px-5 py-3">{e.start ? fmt(e.start * 1000) : "-"}</td>
                        <td className="whitespace-nowrap px-5 py-3">{e.end ? fmt(e.end * 1000) : "-"}</td>
                        <td className="px-5 py-3">{e.title ?? "-"}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{e.product_count ?? "-"}</td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-500">{e.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
