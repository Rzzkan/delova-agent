/**
 * Rubrik skor listing produk, disalin dari "Aturan Kerja Tim AI Delova (Baku)" (per 31 Okt 2026):
 *  - L.4 / L.9 Format judul baku: [Nama Brand] - [Nama Produk] [Kata Kunci Produk], 20-120 karakter (Shopee),
 *    tanpa klaim tak terbukti (Original, Best Seller, Termurah, Viral, Terbaru, ori, premium, anti-kusut, dan sejenisnya)
 *  - Bagian Eko: kata kunci utama natural (jenis, bahan, motif/model, target pemakai), tanpa pengulangan berlebihan,
 *    tanpa kata menyesatkan, hanya nama + deskripsi
 *  - Aturan konten Hendra: scarf printed tidak disebut batik; jangan mengarang data (bahan, harga, rating)
 *  - Karakter tiap toko: Wardrobe wastra & kebaya, Kids anak, Scarf hijab pashmina viscose, Daily modern minimalis tanpa wastra
 *  - Kids: tanpa klaim medis/perkembangan anak, tanpa menekan pembelian
 * Bila dokumen baku berubah, perbarui file ini. Parameter bertanda source "tambahan" bukan dari dokumen baku.
 */
import { validateTitle, type Limits } from "./seo";
import type { Brand } from "./scoring";

export const BRAND_NAME: Record<Brand, string> = { wardrobe: "Delova Wardrobe", kids: "Delova Kids", scarf: "Delova Scarf", daily: "Delova Daily" };
export const BRAND_CHARACTER: Record<Brand, string> = {
  wardrobe: "wastra dan kebaya modern (batik, kebaya, outer)",
  kids: "busana anak perempuan; ramah anak, tanpa klaim medis/perkembangan anak, tanpa menekan pembelian",
  scarf: "hijab pashmina viscose; scarf printed TIDAK boleh disebut batik",
  daily: "pakaian harian modern minimalis tanpa unsur wastra",
};

export type Part = "judul" | "deskripsi";
export interface Param { id: string; part: Part; label: string; max: number; by: "lokal" | "ai"; source: "baku" | "tambahan"; rule: string }

export const PARAMS: Param[] = [
  { id: "format", part: "judul", label: "Format judul baku", max: 20, by: "lokal", source: "baku", rule: "[Nama Brand] - [Nama Produk] [Kata Kunci], brand sesuai toko (L.9)" },
  { id: "panjang", part: "judul", label: "Panjang judul", max: 10, by: "lokal", source: "baku", rule: "Shopee 20-120, TikTok 25-255 karakter (L.4)" },
  { id: "klaim", part: "judul", label: "Tanpa klaim tak terbukti", max: 20, by: "lokal", source: "baku", rule: "Tidak memakai Original, ori, Best Seller, Termurah, Viral, Terbaru, premium, anti-kusut, dan sejenisnya (L.9)" },
  { id: "kebersihan", part: "judul", label: "Bersih dari spam/pengulangan", max: 10, by: "lokal", source: "baku", rule: "Tanpa HURUF KAPITAL berlebihan, emoji, kata promo, atau kata diulang >2x (bagian Eko)" },
  { id: "kain", part: "judul", label: "Aturan kain (scarf ≠ batik)", max: 10, by: "lokal", source: "baku", rule: "Scarf printed tidak disebut batik (aturan Hendra)" },
  { id: "kata_kunci", part: "judul", label: "Kata kunci utama natural", max: 20, by: "ai", source: "baku", rule: "Memuat jenis produk, bahan, motif/model, acara/target pemakai secara natural" },
  { id: "karakter_judul", part: "judul", label: "Sesuai karakter brand", max: 10, by: "ai", source: "baku", rule: "Sesuai karakter toko dan tidak menyesatkan" },
  { id: "d_panjang", part: "deskripsi", label: "Panjang deskripsi", max: 20, by: "lokal", source: "baku", rule: "Shopee maks 3000, TikTok maks 10000 karakter; minimal 100" },
  { id: "d_klaim", part: "deskripsi", label: "Tanpa klaim terlarang & aturan brand", max: 25, by: "lokal", source: "baku", rule: "Tanpa klaim tak terbukti; scarf tanpa 'batik'; Kids tanpa klaim medis/perkembangan & tanpa menekan pembelian" },
  { id: "d_kelengkapan", part: "deskripsi", label: "Kelengkapan & keterbacaan info", max: 30, by: "ai", source: "tambahan", rule: "Jenis, bahan, ukuran/varian, warna, detail pemakaian jelas dan tertata" },
  { id: "d_fakta", part: "deskripsi", label: "Tanpa data karangan", max: 15, by: "ai", source: "baku", rule: "Tidak mengarang bahan, harga, stok, rating, atau klaim tak terbukti (aturan umum 7)" },
  { id: "d_karakter", part: "deskripsi", label: "Sesuai karakter brand", max: 10, by: "ai", source: "baku", rule: "Nada dan isi sesuai karakter toko" },
];
export const WEIGHT = { judul: 0.6, deskripsi: 0.4 } as const;

// ---- pemeriksaan lokal ----
const BANNED = /\b(original|orisinil|ori|best\s*seller|bestseller|termurah|murah\s+banget|viral|terbaru|terlaris|premium|anti\s*[- ]?kusut|no\.?\s*1|nomor\s*1)\b/gi;
const KIDS_MEDIS = /\b(menyembuhkan|obat|terapi|mencerdaskan|meningkatkan\s+kecerdasan|tumbuh\s+kembang|perkembangan\s+anak|menguatkan\s+imun)\b/gi;
const KIDS_TEKAN = /\b(buruan|segera\s+beli|jangan\s+sampai\s+kehabisan|hanya\s+hari\s+ini|stok\s+terbatas|checkout\s+sekarang)\b/gi;
const found = (re: RegExp, text: string) => [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase().replace(/\s+/g, " ")))];

export interface Check { id: string; score: number; max: number; note: string }
const part = (id: string, ratio: number, note: string): Check => ({ id, score: Math.round(Math.max(0, Math.min(1, ratio)) * (PARAMS.find((p) => p.id === id)!.max) * 10) / 10, max: PARAMS.find((p) => p.id === id)!.max, note });

export function checkTitle(name: string, brand: Brand, lim: Limits, description = ""): Check[] {
  const bn = BRAND_NAME[brand];
  const esc = bn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`^${esc}\\s+-\\s+\\S`, "i").test(name.trim());
  const hasBrand = new RegExp(esc, "i").test(name);
  const n = name.trim().length;
  const claims = found(BANNED, name);
  const hygiene = validateTitle(name, lim).filter((i) => !/terlalu (pendek|panjang)|bisa dimaksimalkan/.test(i));
  const batik = brand === "scarf" && /batik/i.test(`${name} ${description}`);
  return [
    part("format", exact ? 1 : hasBrand ? 0.5 : 0, exact ? "Sudah sesuai format baku." : hasBrand ? `Brand ada tetapi bukan format "${bn} - Nama Produk Kata Kunci".` : `Judul belum diawali "${bn} - ".`),
    part("panjang", n >= lim.titleMin && n <= lim.titleMax ? 1 : 0, n >= lim.titleMin && n <= lim.titleMax ? `${n} karakter (batas ${lim.titleMin}-${lim.titleMax}).` : `${n} karakter, di luar batas ${lim.titleMin}-${lim.titleMax}.`),
    part("klaim", 1 - 0.5 * claims.length, claims.length ? `Klaim/kata terlarang: ${claims.join(", ")} (butuh bukti dari Aditya bila ingin dipakai).` : "Tidak ada klaim terlarang."),
    part("kebersihan", 1 - hygiene.length / 3, hygiene.length ? hygiene.join("; ") : "Bersih."),
    part("kain", batik ? 0 : 1, batik ? 'Scarf printed menyebut "batik" (dilarang aturan Hendra).' : "Sesuai aturan kain."),
  ];
}

export function checkDescription(text: string, brand: Brand, lim: Limits): Check[] {
  const n = text.trim().length;
  const claims = found(BANNED, text);
  const batik = brand === "scarf" && /batik/i.test(text);
  const medis = brand === "kids" ? found(KIDS_MEDIS, text) : [];
  const tekan = brand === "kids" ? found(KIDS_TEKAN, text) : [];
  const bad = claims.length + (batik ? 1 : 0) + medis.length + tekan.length;
  const notes = [claims.length && `klaim terlarang: ${claims.join(", ")}`, batik && 'scarf menyebut "batik"', medis.length && `klaim medis/perkembangan: ${medis.join(", ")}`, tekan.length && `menekan pembelian: ${tekan.join(", ")}`].filter(Boolean);
  const ok = n >= lim.descMin && n <= lim.descMax;
  return [
    part("d_panjang", !ok ? (n < lim.descMin ? 0.2 : 0) : n < 300 ? 0.7 : 1, ok ? (n < 300 ? `${n} karakter (sah, tetapi sebaiknya ≥300 agar informatif).` : `${n} karakter.`) : n < lim.descMin ? `Terlalu pendek (${n} < ${lim.descMin}).` : `Terlalu panjang (${n} > ${lim.descMax}).`),
    part("d_klaim", 1 - 0.34 * bad, notes.length ? `Perlu diperbaiki: ${notes.join("; ")}.` : "Tidak ada pelanggaran."),
  ];
}

// ---- versi aturan ----
/** Tanggal revisi dokumen "Aturan Kerja Tim AI Delova (Baku)" yang menjadi dasar rubrik ini. WAJIB diubah saat rubrik disesuaikan. */
export const RUBRIC_DATE = "2026-10-31";
export const BAKU_DOC_ID = "16l66IEo19mepXLc6-uRQr3o-VyYAkAkMWle5blPqctA";
/** Sidik jari rubrik: berubah otomatis bila parameter/bobot/aturan diubah, sehingga cache skor lama tidak dipakai lagi. */
export function rubricVersion(): string {
  const src = JSON.stringify([RUBRIC_DATE, PARAMS, WEIGHT, BANNED.source, KIDS_MEDIS.source, KIDS_TEKAN.source]);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return `${RUBRIC_DATE}.${h.toString(36)}`;
}
