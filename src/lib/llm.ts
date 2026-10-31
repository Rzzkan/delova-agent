/**
 * Insight AI lewat API kompatibel OpenAI (default: Kenari, https://kenari.id/v1).
 * Env: LLM_API_KEY (atau KENARI_API_KEY), LLM_MODEL (wajib), LLM_BASE_URL (opsional).
 * Yang dikirim ke penyedia hanya angka agregat + nama produk; tidak ada data pembeli.
 */
import type { Report } from "./analytics";
import { decryptSecret, getLlmStored } from "./settings";
import { KEYS, getStore } from "./store";

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }
export function loadLlmConfig(): LlmConfig {
  return {
    baseUrl: (process.env.LLM_BASE_URL || "https://kenari.id/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || process.env.KENARI_API_KEY || "",
    model: process.env.LLM_MODEL || "",
  };
}
/** Pengaturan dari dashboard (web) menimpa env; env jadi cadangan. */
export async function resolveLlmConfig(secret = process.env.MCP_SECRET ?? ""): Promise<LlmConfig & { source: { key: "web" | "env" | "none"; model: "web" | "env" | "none"; base: "web" | "env" | "default" } }> {
  const env = loadLlmConfig();
  const st = await getLlmStored().catch(() => ({}) as Awaited<ReturnType<typeof getLlmStored>>);
  const webKey = st.key_enc ? decryptSecret(st.key_enc, secret) : null;
  return {
    baseUrl: (st.base_url || env.baseUrl).replace(/\/+$/, ""),
    apiKey: webKey || env.apiKey,
    model: st.model || env.model,
    source: {
      key: webKey ? "web" : env.apiKey ? "env" : "none",
      model: st.model ? "web" : env.model ? "env" : "none",
      base: st.base_url ? "web" : process.env.LLM_BASE_URL ? "env" : "default",
    },
  };
}
export const llmReady = (c = loadLlmConfig()) => Boolean(c.apiKey && c.model);

export function validateBase(u: string): string | null {
  let x: URL;
  try { x = new URL(u); } catch { return "LLM_BASE_URL tidak valid."; }
  if (x.username || x.password) return "LLM_BASE_URL tidak boleh memuat kredensial.";
  if (x.protocol !== "https:" && !(x.protocol === "http:" && ["localhost", "127.0.0.1"].includes(x.hostname))) return "LLM_BASE_URL harus HTTPS.";
  return null;
}

export async function chat(system: string, user: string, cfg = loadLlmConfig(), maxTokens = 1200): Promise<string> {
  if (!llmReady(cfg)) throw new Error("Model AI belum diatur: isi LLM_API_KEY dan LLM_MODEL di .env server (default penyedia Kenari), lalu jalankan ulang container.");
  const bad = validateBase(cfg.baseUrl);
  if (bad) throw new Error(bad);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, temperature: 0.3, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    throw new Error(`Tidak bisa menghubungi penyedia AI: ${e instanceof Error ? e.message : String(e)}`);
  }
  const j: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Penyedia AI membalas ${res.status}: ${String(j?.error?.message ?? j?.error ?? res.statusText).slice(0, 200)}`);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Penyedia AI mengirim jawaban kosong.");
  return text;
}

export interface Insight {
  ringkasan: string;
  temuan: string[];
  tindakan: string[];
  produk: { item_id: number; catatan: string }[];
  generated_at?: string;
  model?: string;
}

/** Ambil objek JSON pertama dari jawaban model (boleh dibungkus ```json). */
export function parseInsight(text: string): Insight {
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/gi, ""));
  if (!m) throw new Error("Jawaban AI bukan JSON yang bisa dibaca.");
  let o: any;
  try { o = JSON.parse(m[0]); } catch { throw new Error("Jawaban AI bukan JSON yang valid."); }
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 400)).slice(0, 8) : []);
  return {
    ringkasan: String(o.ringkasan ?? "").slice(0, 900),
    temuan: strs(o.temuan),
    tindakan: strs(o.tindakan),
    produk: (Array.isArray(o.produk) ? o.produk : []).map((p: any) => ({ item_id: Number(p?.item_id), catatan: String(p?.catatan ?? "").slice(0, 300) })).filter((p: { item_id: number }) => Number.isFinite(p.item_id)).slice(0, 15),
  };
}

const SYSTEM = `Kamu analis marketplace untuk brand fashion modest Indonesia (Delova). Tugasmu membaca data toko Shopee dan memberi insight yang bisa langsung dikerjakan.
Aturan: pakai Bahasa Indonesia ringkas; hanya berdasarkan angka yang diberikan, jangan mengarang angka; sebut jelas bila data belum cukup.
Catatan data: "konversi" = terjual seumur produk / dilihat seumur produk (bukan per periode). Retur dihitung dari retur yang dibuat pada periode.
Balas HANYA JSON: {"ringkasan": string (2-3 kalimat), "temuan": [string, maks 5], "tindakan": [string, maks 5, konkret dan berurutan prioritas], "produk": [{"item_id": number, "catatan": string}] (maks 8, hanya item_id yang ada di data)}.`;

export function compactReport(r: Report) {
  const pr = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
  const row = (p: Report["top_sellers"][number]) => ({ item_id: p.item_id, nama: p.name.slice(0, 80), terjual_periode: p.units, omzet: p.revenue, retur_unit: p.return_units, retur_persen: pr(p.return_rate), alasan_retur: p.return_reasons, dilihat: p.views, konversi_persen: pr(p.conversion), rating: p.rating });
  const s = r.summary;
  return {
    toko: r.shop_name, periode: `${r.from} s/d ${r.to} (${r.days} hari)`,
    ringkasan: { pesanan: s.orders, batal: s.cancelled, unit: s.units, omzet: s.revenue, rata2_nilai_pesanan: s.aov, retur_pesanan: s.return_count, retur_unit: s.return_units, retur_persen: pr(s.return_rate), biaya_iklan: s.ad_spend, gmv_iklan: s.ad_gmv, roas: s.roas === null ? null : Math.round(s.roas * 100) / 100, acos_persen: pr(s.acos), tacos_persen: pr(s.tacos) },
    terlaris: r.top_sellers.map(row),
    traffic_tinggi_konversi_rendah: { median_konversi_persen: pr(r.traffic_low_conversion.median_conversion), produk: r.traffic_low_conversion.rows.map(row) },
    retur_tertinggi: r.top_returns.map(row),
    catatan_data: r.warnings,
  };
}

const TTL = 6 * 3600 * 1000;
export async function insightFor(r: Report, o: { fresh?: boolean; cfg?: LlmConfig } = {}): Promise<Insight> {
  const cfg = o.cfg ?? loadLlmConfig();
  const key = `${r.shop_id}:${r.days}`;
  const store = getStore();
  const hit = await store.hget<{ t: number; insight: Insight }>(KEYS.aiInsight, key);
  if (!o.fresh && hit && Date.now() - hit.t < TTL) return hit.insight;
  if (!llmReady(cfg)) throw new Error("Model AI belum diatur: isi LLM_API_KEY dan LLM_MODEL di .env server (default penyedia Kenari), lalu jalankan ulang container.");
  const text = await chat(SYSTEM, `Data toko (JSON):\n${JSON.stringify(compactReport(r))}`, cfg);
  const known = new Set([...r.top_sellers, ...r.traffic_low_conversion.rows, ...r.top_returns].map((p) => p.item_id));
  const ins = parseInsight(text);
  ins.produk = ins.produk.filter((p) => known.has(p.item_id));
  ins.generated_at = new Date().toISOString();
  ins.model = cfg.model;
  await store.hset(KEYS.aiInsight, key, { t: Date.now(), insight: ins });
  return ins;
}
