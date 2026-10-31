"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ProductRow, Report } from "@/lib/analytics";
import type { Insight } from "@/lib/llm";
import Shell, { useShell } from "../Shell";
import { BTN, BTN_DEFAULT, BTN_PRIMARY, Badge, Card, Empty, Note, PageTitle, rp } from "../ui";

const selectCls = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";
const pct = (v: number | null | undefined, d = 1) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
const nf = (n: number) => n.toLocaleString("id-ID");

export default function AnalyticsClient() {
  return (
    <Shell active="analitik">
      <Page />
    </Shell>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-error-600" : tone === "ok" ? "text-success-600" : "text-gray-900 dark:text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800"><h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>{sub && <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}
const th = "px-5 py-3 font-medium";
const THEAD = "bg-gray-50 text-xs uppercase text-gray-500 dark:bg-white/5 dark:text-gray-400";
const NameCell = ({ p }: { p: ProductRow }) => <td className="max-w-md px-5 py-3"><div className="font-medium text-gray-800 dark:text-gray-200">{p.name || `Produk ${p.item_id}`}</div><div className="font-mono text-xs text-gray-400">ID {p.item_id}</div></td>;

function Page() {
  const { unauthorized } = useShell();
  const [shops, setShops] = useState<{ shop_id: string; shop_name: string | null }[] | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [shop, setShop] = useState("");
  const [days, setDays] = useState(7);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<Insight | null>(null);
  const [aiErr, setAiErr] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const get = useCallback(async (qs: string) => {
    const res = await fetch(`/api/dashboard/analytics?${qs}`, { cache: "no-store" });
    if (res.status === 401) { unauthorized(); throw new Error("sesi berakhir"); }
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    return j;
  }, [unauthorized]);

  useEffect(() => {
    get("view=shops").then((j) => { setShops(j.shops); setAiReady(j.ai_ready); if (j.shops[0]) setShop(j.shops[0].shop_id); }).catch((e) => setErr(e.message));
  }, [get]);

  const load = useCallback(async (refresh = false) => {
    if (!shop) return;
    setBusy(true); setAi(null); setAiErr("");
    try { setR(await get(`shop=${shop}&days=${days}${refresh ? "&refresh=1" : ""}`)); setErr(""); }
    catch (e) { setR(null); setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [get, shop, days]);
  useEffect(() => { void load(); }, [load]);

  async function runAi(fresh = false) {
    setAiBusy(true); setAiErr("");
    try {
      const res = await fetch("/api/dashboard/analytics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shop, days, fresh }) });
      if (res.status === 401) return unauthorized();
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setAi(j.insight);
    } catch (e) { setAiErr(e instanceof Error ? e.message : String(e)); }
    finally { setAiBusy(false); }
  }

  const s = r?.summary;
  const maxRev = Math.max(1, ...(s?.daily.map((d) => Math.max(d.revenue, d.ad_spend)) ?? [1]));
  const noteFor = (id: number) => ai?.produk.find((p) => p.item_id === id)?.catatan;

  return (
    <>
      <PageTitle title="Penjualan & traffic" sub="Omzet, traffic produk, retur, dan biaya iklan per toko Shopee. Data TikTok Shop belum didukung." action={<button disabled={busy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load(true)}>{busy ? "Memuat…" : "Muat ulang"}</button>} />
      {shops && shops.length === 0 && <Card><Empty>Belum ada toko Shopee terhubung.</Empty></Card>}
      {shops && shops.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <select className={selectCls} value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Toko">{shops.map((x) => <option key={x.shop_id} value={x.shop_id}>{x.shop_name ?? x.shop_id}</option>)}</select>
          <select className={selectCls} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periode">{[7, 14, 30].map((d) => <option key={d} value={d}>{d} hari terakhir</option>)}</select>
        </div>
      )}
      {err && <Note tone="warn">{err}</Note>}
      {busy && !r && <Card><Empty>Memuat data (bisa 10–30 detik untuk toko ramai)…</Empty></Card>}

      {r && s && (
        <>
          {r.warnings.map((w) => <Note key={w} tone="warn">Sebagian data tidak tersedia — {w}</Note>)}
          {r.truncated && <Note tone="warn">Pesanan sangat banyak; hanya 3.000 pesanan pertama yang dihitung, jadi angka bisa lebih kecil dari aslinya.</Note>}

          <div className="mb-4 mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Omzet" value={rp(s.revenue)} sub={`${r.from} → ${r.to}`} />
            <Kpi label="Pesanan" value={nf(s.orders)} sub={`${nf(s.units)} unit · ${s.cancelled} batal`} />
            <Kpi label="Rata-rata nilai pesanan" value={rp(s.aov)} />
            <Kpi label="Retur" value={pct(s.return_rate)} sub={`${s.return_units} unit · ${s.return_count} pengajuan`} tone={(s.return_rate ?? 0) > 0.05 ? "bad" : undefined} />
            <Kpi label="Biaya iklan" value={rp(s.ad_spend)} sub={`${nf(s.ad_clicks)} klik · ${nf(s.ad_impressions)} tayang`} />
            <Kpi label="ROAS iklan" value={s.roas === null ? "-" : `${s.roas.toFixed(2)}x`} sub={`GMV iklan ${rp(s.ad_gmv)}`} tone={s.roas === null ? undefined : s.roas >= 4 ? "ok" : s.roas < 2 ? "bad" : undefined} />
            <Kpi label="ACOS" value={pct(s.acos)} sub="biaya iklan / GMV iklan" />
            <Kpi label="TACOS" value={pct(s.tacos)} sub="biaya iklan / omzet toko" />
          </div>

          <section className="mb-4 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/30 dark:bg-brand-500/5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">✨ Insight AI</h3>
              {ai?.model && <Badge tone="mute">{ai.model}</Badge>}
              <span className="flex-1" />
              {aiReady ? <button className={`${BTN} ${BTN_PRIMARY}`} disabled={aiBusy} onClick={() => runAi(!!ai)}>{aiBusy ? "Menganalisis…" : ai ? "Analisis ulang" : "Buat insight"}</button> : null}
            </div>
            {!aiReady && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Model AI belum diatur. Buka <a className="text-brand-500 underline" href="/dashboard/pengaturan">Pengaturan AI</a> untuk memilih model dan mengisi kunci (default penyedia Kenari).</p>}
            {aiErr && <p className="mt-2 break-words text-sm text-error-600">{aiErr}</p>}
            {ai && (
              <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <p>{ai.ringkasan}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div><b>Temuan</b><ul className="mt-1 list-disc space-y-1 pl-5">{ai.temuan.map((t) => <li key={t}>{t}</li>)}</ul></div>
                  <div><b>Tindakan</b><ol className="mt-1 list-decimal space-y-1 pl-5">{ai.tindakan.map((t) => <li key={t}>{t}</li>)}</ol></div>
                </div>
                <p className="text-xs text-gray-500">Yang dikirim ke penyedia AI hanya angka agregat dan nama produk, tanpa data pembeli. Hasil disimpan 6 jam.</p>
              </div>
            )}
          </section>

          <Section title="Omzet dan biaya iklan per hari">
            {s.daily.length === 0 ? <Empty>Tidak ada data harian.</Empty> : (
              <div className="flex h-44 items-end gap-1 px-5 pb-3 pt-6">
                {s.daily.map((d) => (
                  <div key={d.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5" title={`${d.day}: omzet ${rp(d.revenue)} · ${d.orders} pesanan · iklan ${rp(d.ad_spend)}`}>
                    <div className="w-full rounded-t bg-brand-500" style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
                    <div className="w-full rounded-t bg-warning-500" style={{ height: `${(d.ad_spend / maxRev) * 100}%` }} />
                    <span className="truncate text-center text-[10px] text-gray-400">{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="px-5 pb-3 text-xs text-gray-500"><i className="mr-1 inline-block size-2 rounded-sm bg-brand-500" />omzet <i className="mx-1 ml-3 inline-block size-2 rounded-sm bg-warning-500" />biaya iklan (arahkan kursor untuk angka)</p>
          </Section>

          <Section title="Traffic bagus, konversi jelek" sub={`Produk dengan tayangan tinggi tetapi konversi (terjual ÷ dilihat, seumur produk) di bawah median toko${r.traffic_low_conversion.median_conversion != null ? ` (${pct(r.traffic_low_conversion.median_conversion, 2)})` : ""}. Kandidat perbaikan foto, judul, harga, atau deskripsi.`}>
            {r.traffic_low_conversion.rows.length === 0 ? <Empty>Belum ada produk yang terdeteksi (butuh minimal 4 produk dengan ≥100 tayangan).</Empty> : (
              <table className="w-full min-w-[760px] text-left text-sm"><thead className={THEAD}><tr><th className={th}>Produk</th><th className={`${th} text-right`}>Dilihat</th><th className={`${th} text-right`}>Terjual</th><th className={`${th} text-right`}>Konversi</th><th className={`${th} text-right`}>Potensi pesanan</th><th className={th}>Catatan AI</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{r.traffic_low_conversion.rows.map((p) => (
                  <tr key={p.item_id}><NameCell p={p} /><td className="px-5 py-3 text-right tabular-nums">{nf(p.views)}</td><td className="px-5 py-3 text-right tabular-nums">{nf(p.sold_lifetime)}</td><td className="px-5 py-3 text-right tabular-nums"><Badge tone="bad">{pct(p.conversion, 2)}</Badge></td><td className="px-5 py-3 text-right tabular-nums">+{nf(p.potential_orders)}</td><td className="max-w-xs px-5 py-3 text-xs text-gray-500">{noteFor(p.item_id) ?? "-"}</td></tr>
                ))}</tbody></table>
            )}
          </Section>

          <Section title="Retur tertinggi" sub="Urut jumlah unit retur pada periode. Rasio = unit retur ÷ unit terjual pada periode yang sama (perkiraan, karena retur bisa berasal dari pesanan sebelum periode).">
            {r.top_returns.length === 0 ? <Empty>Tidak ada retur pada periode ini (atau izin Retur belum aktif).</Empty> : (
              <table className="w-full min-w-[760px] text-left text-sm"><thead className={THEAD}><tr><th className={th}>Produk</th><th className={`${th} text-right`}>Retur (unit)</th><th className={`${th} text-right`}>Terjual</th><th className={`${th} text-right`}>Rasio</th><th className={th}>Alasan utama</th><th className={th}>Catatan AI</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{r.top_returns.map((p) => (
                  <tr key={p.item_id}><NameCell p={p} /><td className="px-5 py-3 text-right font-medium tabular-nums">{p.return_units}</td><td className="px-5 py-3 text-right tabular-nums">{p.units}</td><td className="px-5 py-3 text-right tabular-nums">{p.return_rate === null ? "-" : <Badge tone={p.return_rate > 0.1 ? "bad" : p.return_rate > 0.05 ? "warn" : "mute"}>{pct(p.return_rate)}</Badge>}</td><td className="px-5 py-3 text-xs text-gray-500">{p.return_reasons.join(", ") || "-"}</td><td className="max-w-xs px-5 py-3 text-xs text-gray-500">{noteFor(p.item_id) ?? "-"}</td></tr>
                ))}</tbody></table>
            )}
          </Section>

          <Section title="Produk terlaris" sub="Urut unit terjual pada periode.">
            {r.top_sellers.length === 0 ? <Empty>Belum ada penjualan pada periode ini.</Empty> : (
              <table className="w-full min-w-[640px] text-left text-sm"><thead className={THEAD}><tr><th className={th}>Produk</th><th className={`${th} text-right`}>Unit</th><th className={`${th} text-right`}>Omzet</th><th className={`${th} text-right`}>Pesanan</th><th className={`${th} text-right`}>Retur</th><th className={`${th} text-right`}>Rating</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{r.top_sellers.map((p) => (
                  <tr key={p.item_id}><NameCell p={p} /><td className="px-5 py-3 text-right font-medium tabular-nums">{nf(p.units)}</td><td className="px-5 py-3 text-right tabular-nums">{rp(p.revenue)}</td><td className="px-5 py-3 text-right tabular-nums">{nf(p.orders)}</td><td className="px-5 py-3 text-right tabular-nums">{pct(p.return_rate)}</td><td className="px-5 py-3 text-right tabular-nums">{p.rating ?? "-"}</td></tr>
                ))}</tbody></table>
            )}
          </Section>
        </>
      )}
    </>
  );
}
