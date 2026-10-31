/**
 * Skor SEO judul & deskripsi (0-100) berdasarkan aturan baku di seo.ts, murni lokal.
 * Skor = 100 dikurangi penalti per pelanggaran; rinciannya dikembalikan agar bisa ditampilkan.
 * Penalti "bisa dilengkapi" untuk deskripsi < 300 karakter adalah tambahan skor, bukan syarat marketplace.
 */
import { Limits, SHOPEE_LIMITS, validateDescription, validateTitle } from "./seo";

export interface Score {
  score: number;
  grade: "A" | "B" | "C" | "D";
  notes: string[]; // pelanggaran + penalti, siap tampil
}

export const grade = (s: number): Score["grade"] => (s >= 90 ? "A" : s >= 75 ? "B" : s >= 60 ? "C" : "D");

function finish(penalties: [number, string][]): Score {
  const score = Math.max(0, 100 - penalties.reduce((a, [p]) => a + p, 0));
  return { score, grade: grade(score), notes: penalties.map(([p, n]) => `-${p} ${n}`) };
}

/** Penalti judul dipetakan dari pesan validateTitle agar selalu sejalan dengan aturan baku. */
export function scoreTitle(name: string, lim: Limits = SHOPEE_LIMITS): Score {
  const pen: [number, string][] = [];
  for (const issue of validateTitle(name, lim)) {
    if (issue.startsWith("terlalu pendek")) pen.push([40, issue]);
    else if (issue.startsWith("terlalu panjang")) pen.push([50, issue]);
    else if (issue.startsWith("masih bisa dimaksimalkan")) pen.push([15, issue]);
    else if (issue.includes("HURUF KAPITAL")) pen.push([15, issue]);
    else if (issue.includes("emoji")) pen.push([10, issue]);
    else if (issue.includes("promo/spam")) pen.push([15, issue]);
    else if (issue.startsWith("kata diulang")) pen.push([10, issue]);
    else pen.push([5, issue]);
  }
  return finish(pen);
}

export function scoreDescription(text: string, lim: Limits = SHOPEE_LIMITS): Score {
  const pen: [number, string][] = [];
  for (const issue of validateDescription(text, lim)) pen.push([issue.includes("pendek") ? 40 : 50, issue]);
  const n = text.trim().length;
  if (n >= lim.descMin && n < 300) pen.push([15, `bisa dilengkapi (${n} karakter, disarankan >= 300)`]);
  return finish(pen);
}

/** Skor gabungan: judul 60%, deskripsi 40%. Bila deskripsi tidak diketahui, memakai skor judul saja. */
export function combined(title: Score, desc?: Score): number {
  return desc ? Math.round(title.score * 0.6 + desc.score * 0.4) : title.score;
}

export type Brand = "wardrobe" | "kids" | "scarf" | "daily";
export const BRANDS: Brand[] = ["wardrobe", "kids", "scarf", "daily"];
export const BRAND_LABEL: Record<Brand, string> = { wardrobe: "Delova Wardrobe", kids: "Delova Kids", scarf: "Delova Scarf", daily: "Delova Daily" };

/** Tentukan brand dari nama toko (kids/scarf/daily; selain itu Wardrobe). */
export function brandOf(shopName?: string | null): Brand {
  const n = (shopName ?? "").toLowerCase();
  if (/kids/.test(n)) return "kids";
  if (/scar[fv]|hijab/.test(n)) return "scarf";
  if (/daily/.test(n)) return "daily";
  return "wardrobe";
}
