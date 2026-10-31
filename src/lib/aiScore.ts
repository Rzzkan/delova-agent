/** Skor listing berbasis AI (Kenari) memakai rubrik baku Delova. Parameter lokal dihitung kode; parameter bahasa dinilai AI. */
import { chat, llmReady, resolveLlmConfig, type LlmConfig } from "./llm";
import { getStore, KEYS } from "./store";
import { grade, type Brand } from "./scoring";
import { BRAND_CHARACTER, BRAND_NAME, PARAMS, WEIGHT, checkDescription, checkTitle, rubricVersion, type Check } from "./rubric";
import type { Limits } from "./seo";

export interface AiScoreInput { platform: "shopee" | "tiktok"; shop_id: string; product_id: string; brand: Brand; name: string; description: string; limits: Limits }
export interface AiScore {
  platform: string; shop_id: string; product_id: string; rubric: string; model: string; created_at: string; content_hash: string;
  checks: (Check & { label: string; part: "judul" | "deskripsi"; by: "lokal" | "ai"; source: "baku" | "tambahan" })[];
  title_score: number; desc_score: number; total: number; grade: "A" | "B" | "C" | "D";
  ai_ok: boolean; ai_error?: string; summary: string; issues: string[]; suggested_title?: string;
}

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const cacheKey = (i: Pick<AiScoreInput, "platform" | "shop_id" | "product_id">) => `${i.platform}:${i.shop_id}:${i.product_id}`;

export function buildPrompt(i: AiScoreInput): { system: string; user: string } {
  const aiParams = PARAMS.filter((p) => p.by === "ai");
  const system = [
    "Kamu penilai listing produk marketplace untuk grup toko Delova. Nilai HANYA berdasarkan aturan baku di bawah. Jangan mengarang fakta produk.",
    `Aturan format judul baku: "[Nama Brand] - [Nama Produk] [Kata Kunci Produk]". Brand toko ini: ${BRAND_NAME[i.brand]}. Karakter toko: ${BRAND_CHARACTER[i.brand]}.`,
    "Larangan: klaim tak terbukti (Original, ori, Best Seller, Termurah, Viral, Terbaru, premium, anti-kusut, dan sejenisnya); scarf printed tidak boleh disebut batik; jangan mengarang bahan, harga, stok, rating.",
    "Keterangan kondisi (Reject/Minus) dan keterangan varian ukuran harus dipertahankan.",
    "Parameter yang kamu nilai (beri angka 0 sampai max, dan catatan singkat berbahasa Indonesia):",
    ...aiParams.map((p) => `- ${p.id} (max ${p.max}): ${p.label}. ${p.rule}`),
    'Balas HANYA JSON valid: {"checks":[{"id":"...","score":0,"note":"..."}],"summary":"1-2 kalimat","issues":["masalah utama"],"suggested_title":"judul usulan sesuai format baku, hanya memakai kata dari judul/deskripsi asli, atau kosong jika sudah baik"}.',
  ].join("\n");
  const user = `Platform: ${i.platform}\nBatas judul: ${i.limits.titleMin}-${i.limits.titleMax} karakter\n\nJUDUL:\n${i.name}\n\nDESKRIPSI:\n${i.description.slice(0, 3500) || "(kosong)"}`;
  return { system, user };
}

export function parseAi(text: string): { checks: { id: string; score: number; note: string }[]; summary: string; issues: string[]; suggested_title?: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Respons AI bukan JSON.");
  const j = JSON.parse(m[0]);
  const ids = new Set(PARAMS.filter((p) => p.by === "ai").map((p) => p.id));
  const checks = (Array.isArray(j.checks) ? j.checks : []).filter((c: any) => ids.has(c?.id)).map((c: any) => ({ id: String(c.id), score: Number(c.score), note: String(c.note ?? "").slice(0, 300) })).filter((c: any) => Number.isFinite(c.score));
  if (!checks.length) throw new Error("AI tidak memberi nilai untuk parameter yang diminta.");
  return {
    checks,
    summary: String(j.summary ?? "").slice(0, 400),
    issues: (Array.isArray(j.issues) ? j.issues : []).map(String).slice(0, 8),
    suggested_title: typeof j.suggested_title === "string" && j.suggested_title.trim() ? j.suggested_title.trim().slice(0, 300) : undefined,
  };
}

const meta = (id: string) => PARAMS.find((p) => p.id === id)!;

export function assemble(i: AiScoreInput, local: Check[], ai: ReturnType<typeof parseAi> | null, aiError: string | undefined, model: string): AiScore {
  const aiChecks: Check[] = PARAMS.filter((p) => p.by === "ai").map((p) => {
    const hit = ai?.checks.find((c) => c.id === p.id);
    return hit ? { id: p.id, max: p.max, score: Math.max(0, Math.min(p.max, hit.score)), note: hit.note } : { id: p.id, max: p.max, score: 0, note: "Tidak dinilai (AI tidak tersedia)." };
  });
  const all = [...local, ...aiChecks].map((c) => ({ ...c, label: meta(c.id).label, part: meta(c.id).part, by: meta(c.id).by, source: meta(c.id).source }));
  // Bila AI gagal, skor dinormalisasi dari parameter lokal saja agar tidak menghukum produk karena gangguan AI.
  const pct = (part: "judul" | "deskripsi") => {
    const rows = all.filter((c) => c.part === part && (ai || c.by === "lokal"));
    const max = rows.reduce((a, c) => a + c.max, 0);
    return max ? Math.round((rows.reduce((a, c) => a + c.score, 0) / max) * 100) : 0;
  };
  const title_score = pct("judul"), desc_score = pct("deskripsi");
  const total = Math.round(title_score * WEIGHT.judul + desc_score * WEIGHT.deskripsi);
  return {
    platform: i.platform, shop_id: i.shop_id, product_id: i.product_id, rubric: rubricVersion(), model, created_at: new Date().toISOString(),
    content_hash: hash(`${i.name}\n${i.description}`), checks: all, title_score, desc_score, total, grade: grade(total),
    ai_ok: Boolean(ai), ...(aiError ? { ai_error: aiError } : {}), summary: ai?.summary ?? "", issues: ai?.issues ?? [], ...(ai?.suggested_title ? { suggested_title: ai.suggested_title } : {}),
  };
}

export async function getCachedScore(i: Pick<AiScoreInput, "platform" | "shop_id" | "product_id" | "name" | "description">): Promise<AiScore | null> {
  const s = await getStore().hget<AiScore>(KEYS.listingScores, cacheKey(i));
  if (!s || s.rubric !== rubricVersion() || s.content_hash !== hash(`${i.name}\n${i.description}`) || !s.ai_ok) return null;
  return s;
}

export async function aiScoreListing(i: AiScoreInput, o: { fresh?: boolean; cfg?: LlmConfig } = {}): Promise<AiScore & { cached: boolean }> {
  if (!o.fresh) { const c = await getCachedScore(i); if (c) return { ...c, cached: true }; }
  const cfg = o.cfg ?? (await resolveLlmConfig());
  const local = [...checkTitle(i.name, i.brand, i.limits, i.description), ...checkDescription(i.description, i.brand, i.limits)];
  let ai: ReturnType<typeof parseAi> | null = null, err: string | undefined;
  if (!llmReady(cfg)) err = "AI belum dikonfigurasi (isi di Pengaturan AI).";
  else {
    try { const p = buildPrompt(i); ai = parseAi(await chat(p.system, p.user, cfg, 900)); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
  }
  const out = assemble(i, local, ai, err, cfg.model);
  if (out.ai_ok) await getStore().hset(KEYS.listingScores, cacheKey(i), out);
  return { ...out, cached: false };
}
