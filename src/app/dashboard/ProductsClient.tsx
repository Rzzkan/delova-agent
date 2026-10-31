"use client";

import { useCallback, useEffect, useState } from "react";
import type { Limits } from "@/lib/seo";
import type { Score } from "@/lib/scoring";
import type { Price } from "@/lib/prices";
import Shell, { useShell } from "./Shell";
import { BTN, BTN_DEFAULT, Badge, Card, Empty, Note, PageTitle, rp } from "./ui";

type Platform = "shopee" | "tiktok";
interface Row { id: string; name: string; status: string | null; title_score?: number; title_grade?: string; price?: Price }
interface Detail extends Row { description: string; description_format: "teks" | "html"; limits: Limits; issues: string[]; title: Score; desc: Score; total: number }
interface ShopInfo { shop_id: string; shop_name: string | null }

const LABEL: Record<Platform, string> = { shopee: "Shopee", tiktok: "TikTok Shop" };
const STATUS: Record<Platform, { v: string; l: string }[]> = {
  shopee: [{ v: "NORMAL", l: "Aktif" }, { v: "UNLIST", l: "Disembunyikan" }, { v: "BANNED", l: "Diblokir" }, { v: "REVIEWING", l: "Ditinjau" }],
  tiktok: [{ v: "", l: "Semua status" }, { v: "ACTIVATE", l: "Aktif" }, { v: "DRAFT", l: "Draf" }, { v: "SELLER_DEACTIVATED", l: "Dinonaktifkan" }, { v: "PLATFORM_DEACTIVATED", l: "Dinonaktifkan platform" }],
};
const inputCls = "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:text-gray-200";
const selectCls = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";

export default function ProductsClient({ platform }: { platform: Platform }) {
  return (
    <Shell active={platform === "shopee" ? "produk-shopee" : "produk-tiktok"}>
      <Page platform={platform} />
    </Shell>
  );
}

function Page({ platform }: { platform: Platform }) {
  const { unauthorized } = useShell();
  const [shops, setShops] = useState<ShopInfo[] | null>(null);
  const [shop, setShop] = useState("");
  const [status, setStatus] = useState(STATUS[platform][0].v);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]); // riwayat halaman; elemen terakhir = halaman aktif
  const [page, setPage] = useState<{ items: Row[]; next: string | null; total: number | null } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyDisc, setOnlyDisc] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const api = useCallback(
    async (qs: string) => {
      const r = await fetch(`/api/dashboard/products?platform=${platform}&${qs}`, { cache: "no-store" });
      if (r.status === 401) { unauthorized(); throw new Error("sesi berakhir"); }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    [platform, unauthorized],
  );

  useEffect(() => {
    api("view=shops").then((j) => {
      setShops(j.shops);
      if (j.shops[0]) setShop(j.shops[0].shop_id);
    }).catch((e) => setErr(e.message));
  }, [api]);

  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async () => {
    if (!shop) return;
    setBusy(true);
    try {
      const p = new URLSearchParams({ view: "list", shop, status, cursor, q: query });
      setPage(await api(p.toString()));
      setErr("");
    } catch (e) {
      setPage(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, shop, status, cursor, query]);
  useEffect(() => { void load(); }, [load]);

  const reset = () => setCursors([""]);
  const shopName = shops?.find((s) => s.shop_id === shop)?.shop_name ?? shop;

  return (
    <>
      <PageTitle
        title={`Produk ${LABEL[platform]}`}
        sub="Hanya lihat: daftar produk dengan skor SEO judul/deskripsi. Perubahan diusulkan lewat chat Claude dan disetujui di menu Persetujuan."
        action={<button disabled={busy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load()}>{busy ? "Memuat…" : "Muat ulang"}</button>}
      />
      {shops && shops.length === 0 && <Card><Empty>Belum ada toko {LABEL[platform]} terhubung.</Empty></Card>}
      {shops && shops.length > 0 && (
        <div className="mb-4 mt-3 flex flex-wrap gap-2">
          <select className={selectCls} value={shop} onChange={(e) => { setShop(e.target.value); reset(); }} aria-label="Pilih toko">
            {shops.map((s) => <option key={s.shop_id} value={s.shop_id}>{s.shop_name ?? s.shop_id}</option>)}
          </select>
          <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} aria-label="Status">
            {STATUS[platform].map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); reset(); }}>
            <input className={`${inputCls} h-10 w-56`} placeholder="Cari nama produk…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={`${BTN} ${BTN_DEFAULT}`}>Cari</button>
          </form>
          <label className="flex h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" className="size-4 accent-brand-500" checked={onlyDisc} onChange={(e) => setOnlyDisc(e.target.checked)} />Hanya yang diskon</label>
        </div>
      )}
      {err && <Note tone="warn">{err}</Note>}
      {shop && !page && !err && <Card><Empty>Memuat produk…</Empty></Card>}
      {page && (
        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{shopName}</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">{LABEL[platform]} · ID {shop}{page.total != null ? ` · ${page.total} produk` : ""}</span>
          </div>
          {page.items.length === 0 ? (
            <Empty>Tidak ada produk.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-white/5 dark:text-gray-400">
                  <tr><th className="px-5 py-3 font-medium">Produk</th><th className="px-5 py-3 text-right font-medium">Harga asli</th><th className="px-5 py-3 text-right font-medium">Harga diskon</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Skor judul</th><th className="px-5 py-3 text-right font-medium">Detail</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {page.items.filter((p) => !onlyDisc || (p.price?.discount_pct ?? 0) > 0 || p.price?.any_discount).map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3"><div className="font-medium text-gray-800 dark:text-gray-200">{p.name}</div><div className="font-mono text-xs text-gray-400">ID {p.id} · {p.name.length} karakter</div></td>
                      <PriceCells p={p.price} />
                      <td className="px-5 py-3">{p.status ? <Badge tone={p.status === "NORMAL" || p.status === "ACTIVATE" ? "ok" : "mute"}>{p.status}</Badge> : "-"}</td>
                      <td className="px-5 py-3">{p.title_score == null ? "-" : <Badge tone={GRADE_TONE[p.title_grade ?? "D"]}>{p.title_score} · {p.title_grade}</Badge>}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <button className={`${BTN} ${BTN_DEFAULT} !py-1.5`} onClick={() => setView(p.id)}>Lihat &amp; skor</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-gray-800">
            <button className={`${BTN} ${BTN_DEFAULT} !py-1.5`} disabled={cursors.length < 2 || busy} onClick={() => setCursors((c) => c.slice(0, -1))}>← Sebelumnya</button>
            <span className="text-xs text-gray-500 dark:text-gray-400">Halaman {cursors.length}</span>
            <button className={`${BTN} ${BTN_DEFAULT} !py-1.5`} disabled={!page.next || busy} onClick={() => setCursors((c) => [...c, page.next!])}>Berikutnya →</button>
          </div>
        </section>
      )}
      {view && <DetailModal id={view} shop={shop} platform={platform} api={api} onClose={() => setView(null)} />}
    </>
  );
}

function PriceCells({ p }: { p?: Price }) {
  if (!p || p.current === null) return <><td className="px-5 py-3 text-right text-gray-400">-</td><td className="px-5 py-3 text-right text-gray-400">-</td></>;
  const mark = p.variants ? <span className="ml-1 text-[10px] text-gray-400">mulai</span> : null;
  const disc = (p.discount_pct ?? 0) > 0;
  return (
    <>
      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{p.original === null ? <span className="text-gray-400">-</span> : <span className={disc ? "text-gray-400 line-through" : ""}>{rp(p.original)}</span>}{mark}</td>
      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
        {disc ? <><b className="text-error-600">{rp(p.current)}</b> <Badge tone="bad">-{p.discount_pct}%</Badge></> : <span>{rp(p.current)}{p.current_max ? ` – ${rp(p.current_max)}` : ""}</span>}
      </td>
    </>
  );
}

export const GRADE_TONE: Record<string, string> = { A: "ok", B: "info", C: "warn", D: "bad" };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-900/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScoreBox({ label, s }: { label: string; s: Score }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center gap-2"><span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span><Badge tone={GRADE_TONE[s.grade]}>{s.score} · {s.grade}</Badge></div>
      {s.notes.length > 0 ? <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gray-500 dark:text-gray-400">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul> : <p className="mt-2 text-xs text-success-600">Memenuhi semua aturan baku.</p>}
    </div>
  );
}

function DetailModal({ id, shop, platform, api, onClose }: { id: string; shop: string; platform: Platform; api: (qs: string) => Promise<any>; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`view=detail&shop=${shop}&id=${id}`).then(setD).catch((e) => setErr(e.message)); }, [api, shop, id]);
  return (
    <Modal title="Detail produk" onClose={onClose}>
      {!d && !err && <Empty>Memuat…</Empty>}
      {err && <p className="break-words text-sm text-error-600">{err}</p>}
      {d && (
        <div className="space-y-4">
          <div><div className="text-xs text-gray-500">Nama · {d.name.length} karakter</div><div className="font-medium text-gray-900 dark:text-white">{d.name}</div><div className="font-mono text-xs text-gray-400">ID {d.id}</div></div>
          <div className="grid gap-3 sm:grid-cols-2"><ScoreBox label="Skor judul" s={d.title} /><ScoreBox label="Skor deskripsi" s={d.desc} /></div>
          <div className="text-sm text-gray-700 dark:text-gray-300">Skor gabungan: <b>{d.total}</b>/100</div>
          <AiScorePanel platform={platform} shop={shop} id={id} />
          <div><div className="mb-1 text-xs text-gray-500">Deskripsi {d.description_format === "html" && "(HTML)"}</div><div className="max-h-60 overflow-y-auto whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">{d.description || "(kosong)"}</div></div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Dashboard hanya untuk melihat dan menyetujui. Perubahan judul/deskripsi diusulkan lewat chat Claude, lalu disetujui di menu Persetujuan.</p>
        </div>
      )}
    </Modal>
  );
}

interface AiRes {
  total: number; grade: string; title_score: number; desc_score: number; summary: string; issues: string[]; suggested_title?: string; cached: boolean; ai_ok: boolean; ai_error?: string; model: string; rubric: string; created_at: string;
  checks: { id: string; label: string; part: string; by: string; source: string; score: number; max: number; note: string }[];
}

function AiScorePanel({ platform, shop, id }: { platform: Platform; shop: string; id: string }) {
  const [r, setR] = useState<AiRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run(fresh: boolean) {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/dashboard/aiscore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform, shop, id, fresh }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setR(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-brand-200 p-3 dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Skor AI (rubrik baku Delova)</span>
        {r && <Badge tone={GRADE_TONE[r.grade]}>{r.total} · {r.grade}</Badge>}
        <button className={`${BTN} ${BTN_DEFAULT} ml-auto`} disabled={busy} onClick={() => run(Boolean(r))}>{busy ? "Menilai…" : r ? "Nilai ulang" : "Nilai dengan AI"}</button>
      </div>
      {err && <p className="mt-2 break-words text-xs text-error-600">{err}</p>}
      {r && (
        <div className="mt-3 space-y-3 text-xs">
          {!r.ai_ok && <p className="text-warning-600">AI tidak tersedia ({r.ai_error}). Hanya parameter lokal yang dinilai.</p>}
          {r.summary && <p className="text-gray-700 dark:text-gray-300">{r.summary}</p>}
          <div className="text-gray-500">Judul {r.title_score} · Deskripsi {r.desc_score} · model {r.model} · rubrik {r.rubric}{r.cached ? " · dari cache" : ""}</div>
          <table className="w-full">
            <tbody>
              {r.checks.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                  <td className="py-1 pr-2 text-gray-700 dark:text-gray-300">{c.label}<div className="text-[10px] text-gray-400">{c.part}{c.by === "ai" ? " · AI" : ""}{c.source === "tambahan" ? " · tambahan" : ""}</div></td>
                  <td className="whitespace-nowrap py-1 pr-2 tabular-nums">{c.score}/{c.max}</td>
                  <td className="py-1 text-gray-500">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-gray-600 dark:text-gray-400">{r.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
          {r.suggested_title && <div className="rounded-lg bg-gray-50 p-2 dark:bg-white/5"><div className="text-gray-500">Usulan judul (minta Claude: "ajukan perubahan judul produk {id}")</div><div className="font-medium text-gray-900 dark:text-white">{r.suggested_title}</div></div>}
        </div>
      )}
    </div>
  );
}
