import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isAuthed, isJsonRequest } from "@/lib/dashboard";
import { chat, llmReady, resolveLlmConfig, validateBase } from "@/lib/llm";
import { MODEL_RE, clearLlmKey, saveLlmStored } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const err = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

async function view(secret: string) {
  const c = await resolveLlmConfig(secret);
  return { base_url: c.baseUrl, model: c.model, has_key: Boolean(c.apiKey), key_hint: c.apiKey ? `••••${c.apiKey.slice(-4)}` : "", source: c.source, ai_ready: llmReady(c) };
}

/** GET -> pengaturan AI saat ini (kunci TIDAK dikirim, hanya 4 karakter terakhir). */
export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await view(cfg.mcpSecret), { headers: { "cache-control": "no-store" } });
}

/** POST {action: "save"|"clear_key"|"models"|"test", base_url?, model?, api_key?} */
export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!isAuthed(req, cfg.mcpSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isJsonRequest(req)) return err("bad request", 415);
  const b = (await req.json().catch(() => ({}))) as { action?: string; base_url?: unknown; model?: unknown; api_key?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const baseUrl = str(b.base_url);
  const model = str(b.model);
  const apiKey = str(b.api_key);
  try {
    if (baseUrl !== undefined) { const bad = validateBase(baseUrl); if (bad) return err(bad); }
    if (model !== undefined && model !== "" && !MODEL_RE.test(model)) return err("Nama model tidak valid (huruf, angka, titik, titik dua, garis, garis miring).");
    if (apiKey !== undefined && apiKey !== "" && (apiKey.length < 8 || apiKey.length > 400 || /\s/.test(apiKey))) return err("Format kunci API tidak valid.");

    if (b.action === "save") {
      await saveLlmStored({ base_url: baseUrl, model, api_key: apiKey || undefined }, cfg.mcpSecret);
      return NextResponse.json(await view(cfg.mcpSecret));
    }
    if (b.action === "clear_key") {
      await clearLlmKey();
      return NextResponse.json(await view(cfg.mcpSecret));
    }
    // models/test: pakai nilai di formulir (belum disimpan) bila diisi, selain itu nilai tersimpan
    const cur = await resolveLlmConfig(cfg.mcpSecret);
    const eff = { baseUrl: (baseUrl || cur.baseUrl).replace(/\/+$/, ""), apiKey: apiKey || cur.apiKey, model: model || cur.model };
    if (b.action === "models") {
      if (!eff.apiKey) return err("Isi kunci API dulu.");
      const res = await fetch(`${eff.baseUrl}/models`, { headers: { authorization: `Bearer ${eff.apiKey}` }, signal: AbortSignal.timeout(20_000) }).catch((e) => { throw new Error(`Tidak bisa menghubungi penyedia: ${e instanceof Error ? e.message : String(e)}`); });
      const j: any = await res.json().catch(() => null);
      if (!res.ok) return err(`Penyedia membalas ${res.status}: ${String(j?.error?.message ?? res.statusText).slice(0, 160)}`, 502);
      const ids = (Array.isArray(j?.data) ? j.data : []).map((m: any) => String(m?.id ?? "")).filter(Boolean).sort().slice(0, 300);
      return NextResponse.json({ models: ids });
    }
    if (b.action === "test") {
      if (!llmReady(eff)) return err("Isi kunci API dan model dulu.");
      const t0 = Date.now();
      const reply = await chat("Jawab singkat.", "Balas hanya dengan kata: OK", eff, 20);
      return NextResponse.json({ ok: true, ms: Date.now() - t0, reply: reply.slice(0, 80) });
    }
    return err("aksi tidak dikenal");
  } catch (e) {
    return err(e, 502);
  }
}
