"use client";

import { useCallback, useEffect, useState } from "react";
import Shell, { useShell } from "../Shell";
import { BTN, BTN_DANGER, BTN_DEFAULT, BTN_PRIMARY, Badge, Card, Empty, Note, PageTitle } from "../ui";

interface View { base_url: string; model: string; has_key: boolean; key_hint: string; source: { key: string; model: string; base: string }; ai_ready: boolean }
const inputCls = "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:text-gray-200";
const PRESETS = [
  ["Kenari (kenari.id)", "https://kenari.id/v1"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["Groq", "https://api.groq.com/openai/v1"],
  ["Gemini (kompatibel OpenAI)", "https://generativelanguage.googleapis.com/v1beta/openai"],
];
const SRC: Record<string, string> = { web: "diatur di dashboard", env: "dari .env server", none: "belum diisi", default: "bawaan (Kenari)" };

export default function SettingsClient() {
  return (
    <Shell active="pengaturan">
      <Page />
    </Shell>
  );
}

function Page() {
  const { unauthorized } = useShell();
  const [v, setV] = useState<View | null>(null);
  const [base, setBase] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [manual, setManual] = useState(false);

  const call = useCallback(async (method: "GET" | "POST", body?: Record<string, unknown>) => {
    const r = await fetch("/api/dashboard/settings", { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (r.status === 401) { unauthorized(); throw new Error("sesi berakhir"); }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }, [unauthorized]);

  const apply = (j: View) => { setV(j); setBase(j.base_url); setModel(j.model); setKey(""); };
  useEffect(() => {
    call("GET").then((j: View) => {
      apply(j);
      if (j.has_key) call("POST", { action: "models" }).then((m) => setModels(m.models)).catch(() => {});
    }).catch((e) => setErr(e.message));
  }, [call]);

  async function run(name: string, body: Record<string, unknown>, ok: (j: any) => void) {
    setBusy(name); setErr(""); setMsg("");
    try { ok(await call("POST", body)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  const form = { base_url: base, model, ...(key ? { api_key: key } : {}) };

  return (
    <>
      <PageTitle title="Pengaturan AI" sub="Model untuk Insight AI di menu Penjualan & traffic. Penyedia apa pun yang kompatibel dengan OpenAI (default Kenari)." />
      {!v && !err && <Card><Empty>Memuat…</Empty></Card>}
      {err && <Note tone="warn">{err}</Note>}
      {msg && <div className="mb-3 mt-3 rounded-lg bg-success-50 px-4 py-2.5 text-sm text-success-600 dark:bg-success-500/15">{msg}</div>}
      {v && (
        <section className="mt-3 max-w-2xl space-y-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2"><Badge tone={v.ai_ready ? "ok" : "warn"}>{v.ai_ready ? "AI siap dipakai" : "Belum lengkap"}</Badge><span className="text-xs text-gray-500">Kunci: {SRC[v.source.key]} · Model: {SRC[v.source.model]} · Alamat: {SRC[v.source.base]}</span></div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Alamat API (Base URL)</label>
            <input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://kenari.id/v1" />
            <div className="mt-1.5 flex flex-wrap gap-1.5">{PRESETS.map(([l, u]) => <button key={u} type="button" className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-400" onClick={() => setBase(u)}>{l}</button>)}</div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Kunci API</label>
            <input className={inputCls} type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={v.has_key ? `Tersimpan (${v.key_hint}). Kosongkan bila tidak diganti` : "Tempel kunci API"} />
            <p className="mt-1 text-xs text-gray-500">Disimpan terenkripsi di server dan tidak pernah ditampilkan kembali.</p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
              <button type="button" className="text-xs text-brand-500 hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => run("models", { action: "models", base_url: base, ...(key ? { api_key: key } : {}) }, (j) => { setModels(j.models); setMsg(`${j.models.length} model ditemukan. Pilih dari dropdown Model.`); })}>{busy === "models" ? "Memuat…" : "Muat daftar model"}</button></div>
            {models.length > 0 && !manual ? (
              <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                {!model && <option value="">— pilih model —</option>}
                {model && !models.includes(model) && <option value={model}>{model} (tidak ada di daftar)</option>}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="nama model, atau klik “Muat daftar model”" />
            )}
            {models.length > 0 && <button type="button" className="mt-1 text-xs text-gray-500 hover:underline" onClick={() => setManual((m) => !m)}>{manual ? "Pilih dari daftar" : "Ketik nama model manual"}</button>}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button className={`${BTN} ${BTN_PRIMARY}`} disabled={!!busy} onClick={() => run("save", { action: "save", ...form }, (j) => { apply(j); setMsg("Pengaturan disimpan."); })}>{busy === "save" ? "Menyimpan…" : "Simpan"}</button>
            <button className={`${BTN} ${BTN_DEFAULT}`} disabled={!!busy} onClick={() => run("test", { action: "test", ...form }, (j) => setMsg(`Koneksi berhasil (${j.ms} ms), model membalas: ${j.reply}`))}>{busy === "test" ? "Menguji…" : "Tes koneksi"}</button>
            {v.has_key && v.source.key === "web" && <button className={`${BTN} ${BTN_DANGER}`} disabled={!!busy} onClick={() => confirm("Hapus kunci yang tersimpan di dashboard?") && run("clear", { action: "clear_key" }, (j) => { apply(j); setMsg("Kunci dihapus."); })}>Hapus kunci</button>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Yang dikirim ke penyedia hanya angka agregat dan nama produk, tanpa data pembeli. "Tes koneksi" memakai nilai di formulir walau belum disimpan.</p>
        </section>
      )}
    </>
  );
}
