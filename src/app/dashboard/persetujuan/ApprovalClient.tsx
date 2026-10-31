"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Proposal } from "@/lib/proposals";
import type { Brand } from "@/lib/scoring";
import { BRAND_LABEL } from "@/lib/scoring";
import Shell, { useShell } from "../Shell";
import { GRADE_TONE } from "../ProductsClient";
import { BTN, BTN_DANGER, BTN_DEFAULT, BTN_PRIMARY, Badge, Card, Empty, Note, PageTitle, fmt } from "../ui";

type Group = { brand: Brand; items: Proposal[] };
const TABS = [
  { v: "pending", l: "Menunggu" },
  { v: "applied", l: "Diterapkan" },
  { v: "rejected", l: "Ditolak" },
  { v: "failed", l: "Gagal" },
  { v: "stale", l: "Kedaluwarsa" },
  { v: "reverted", l: "Dibatalkan" },
];
const PLATFORM_LABEL = { shopee: "Shopee", tiktok: "TikTok Shop" } as const;
const selectCls = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";
const BATCH = 40;

export default function ApprovalClient() {
  return (
    <Shell active="persetujuan">
      <Page />
    </Shell>
  );
}

function Delta({ a, b }: { a: number; b: number }) {
  const d = b - a;
  return <span className={`text-xs font-medium tabular-nums ${d > 0 ? "text-success-600" : d < 0 ? "text-error-600" : "text-gray-400"}`}>{d > 0 ? "+" : ""}{d}</span>;
}

function Page() {
  const { unauthorized } = useShell();
  const [tab, setTab] = useState("pending");
  const [platform, setPlatform] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard/proposals?status=${tab}${platform ? `&platform=${platform}` : ""}`, { cache: "no-store" });
      if (r.status === 401) return unauthorized();
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setGroups(j.groups);
      setReadOnly(j.read_only);
      setSel(new Set());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [tab, platform, unauthorized]);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => (groups ?? []).flatMap((g) => g.items), [groups]);
  const toggle = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });

  async function run(action: "approve" | "reject" | "revert") {
    const ids = [...sel];
    const verb = { approve: "Setujui dan terapkan ke marketplace", reject: "Tolak", revert: "Batalkan (kembalikan ke versi lama)" }[action];
    if (!confirm(`${verb} ${ids.length} usulan?`)) return;
    setBusy(true); setMsg(""); setErr("");
    let ok = 0, bad = 0;
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const r = await fetch("/api/dashboard/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ids: ids.slice(i, i + BATCH) }) });
        if (r.status === 401) return unauthorized();
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const n = j.applied ?? j.rejected ?? j.reverted ?? 0;
        ok += n; bad += ids.slice(i, i + BATCH).length - n;
      }
      setMsg(`${ok} berhasil${bad ? `, ${bad} tidak diproses (lihat tab Gagal/Kedaluwarsa)` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void load();
    }
  }

  const writeOff = readOnly;
  return (
    <>
      <PageTitle title="Persetujuan perubahan" sub="Usulan judul & deskripsi dari Claude. Centang produk per brand lalu setujui sekaligus; sebelum ditulis, nilai lama dicadangkan." action={<button className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load()}>Muat ulang</button>} />
      {readOnly && <Note tone="warn">Mode baca-saja aktif (SHOPEE_READ_ONLY=true): persetujuan ke marketplace diblokir.</Note>}
      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        {TABS.map((t) => <button key={t.v} className={`${BTN} ${tab === t.v ? BTN_PRIMARY : BTN_DEFAULT} !py-1.5`} onClick={() => setTab(t.v)}>{t.l}</button>)}
        <span className="flex-1" />
        <select className={selectCls} value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Marketplace">
          <option value="">Semua marketplace</option><option value="shopee">Shopee</option><option value="tiktok">TikTok Shop</option>
        </select>
      </div>
      {msg && <div className="mb-3 rounded-lg bg-success-50 px-4 py-2.5 text-sm text-success-600 dark:bg-success-500/15">{msg}</div>}
      {err && <Note tone="warn">{err}</Note>}
      {!groups && !err && <Card><Empty>Memuat…</Empty></Card>}
      {groups && groups.length === 0 && <Card><Empty>Tidak ada usulan di tab ini. Minta Claude: “usulkan perbaikan judul untuk produk …”.</Empty></Card>}

      {groups?.map((g) => {
        const ids = g.items.map((p) => p.id);
        const n = ids.filter((i) => sel.has(i)).length;
        return (
          <section key={g.brand} className="mb-4 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <input type="checkbox" className="size-4 accent-brand-500" aria-label={`Pilih semua ${BRAND_LABEL[g.brand]}`} checked={n === ids.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }} onChange={(e) => toggle(ids, e.target.checked)} />
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{BRAND_LABEL[g.brand]}</h3>
              <Badge tone="mute">{g.items.length} usulan</Badge>
              {n > 0 && <Badge tone="info">{n} dipilih</Badge>}
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {g.items.map((p) => (
                <li key={p.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    {tab === "pending" || tab === "applied" ? <input type="checkbox" className="mt-1 size-4 accent-brand-500" checked={sel.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} aria-label="Pilih usulan" /> : <span className="w-4" />}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <Badge tone="mute">{PLATFORM_LABEL[p.platform]}</Badge><span>{p.shop_name ?? p.shop_id}</span><span className="font-mono">ID {p.product_id}</span><span>{fmt(Date.parse(p.created_at))}</span>
                      </div>
                      {p.new_name !== undefined ? (
                        <div className="text-sm"><div className="text-gray-400 line-through">{p.current_name}</div><div className="font-medium text-gray-900 dark:text-white">{p.new_name}</div></div>
                      ) : <div className="text-sm font-medium text-gray-900 dark:text-white">{p.current_name}</div>}
                      {p.new_description !== undefined && <button className="mt-1 text-xs text-brand-500 hover:underline" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Sembunyikan" : "Bandingkan"} deskripsi ({p.current_description.length} → {p.new_description.length} karakter)</button>}
                      {open === p.id && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs text-gray-500 dark:bg-white/5">{p.current_description}</pre>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-success-50 p-2 text-xs text-gray-700 dark:bg-success-500/10 dark:text-gray-300">{p.new_description}</pre>
                        </div>
                      )}
                      {p.note && <p className="mt-1 text-xs italic text-gray-500">Catatan Claude: {p.note}</p>}
                      {p.error && <p className="mt-1 break-words text-xs text-error-600">{p.error}</p>}
                    </div>
                    <div className="shrink-0 space-y-1 text-right text-xs">
                      <div className="flex items-center justify-end gap-1.5"><span className="text-gray-500">Judul</span><Badge tone={GRADE_TONE[p.before.title.grade]}>{p.before.title.score}</Badge>→<Badge tone={GRADE_TONE[p.after.title.grade]}>{p.after.title.score}</Badge><Delta a={p.before.title.score} b={p.after.title.score} /></div>
                      <div className="flex items-center justify-end gap-1.5"><span className="text-gray-500">Deskripsi</span><Badge tone={GRADE_TONE[p.before.desc.grade]}>{p.before.desc.score}</Badge>→<Badge tone={GRADE_TONE[p.after.desc.grade]}>{p.after.desc.score}</Badge><Delta a={p.before.desc.score} b={p.after.desc.score} /></div>
                      <div className="font-medium text-gray-700 dark:text-gray-300">Total {p.before.total} → {p.after.total}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {all.length > 0 && sel.size > 0 && (
        <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{sel.size} dipilih</span>
          <span className="flex-1" />
          {tab === "pending" && (
            <>
              <button className={`${BTN} ${BTN_DANGER}`} disabled={busy} onClick={() => run("reject")}>Tolak</button>
              <button className={`${BTN} ${BTN_PRIMARY}`} disabled={busy || writeOff} onClick={() => run("approve")}>{busy ? "Memproses…" : `Setujui ${sel.size} usulan`}</button>
            </>
          )}
          {tab === "applied" && <button className={`${BTN} ${BTN_DANGER}`} disabled={busy || writeOff} onClick={() => run("revert")}>{busy ? "Memproses…" : "Batalkan perubahan"}</button>}
        </div>
      )}
    </>
  );
}
