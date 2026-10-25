/** Aturan SEO produk (Shopee & TikTok Shop): judul & deskripsi. Murni lokal, tanpa API. */

export const TITLE_MIN = 20;
export const TITLE_MAX = 120; // batas Shopee untuk nama produk
export const DESC_MIN = 100;
export const DESC_MAX = 3000; // batas deskripsi

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const SPAM = /(!!+|\*{2,}|#{2,}|\bpromo\b|\bmurah banget\b|\bdiskon\b|\bsale\b|\bready stock\b)/i;

/** Batas per marketplace. Batas TikTok Shop dari dokumentasi umum; bila API menolak, job menandai gagal beserta alasannya. */
export interface Limits {
  titleMin: number;
  titleMax: number;
  descMin: number;
  descMax: number;
  label: string;
}
export const SHOPEE_LIMITS: Limits = { titleMin: TITLE_MIN, titleMax: TITLE_MAX, descMin: DESC_MIN, descMax: DESC_MAX, label: "Shopee" };
export const TIKTOK_LIMITS: Limits = { titleMin: 25, titleMax: 255, descMin: 100, descMax: 10000, label: "TikTok Shop" };

export function validateTitle(name: string, lim: Limits = SHOPEE_LIMITS): string[] {
  const issues: string[] = [];
  const n = name.trim().length;
  if (n < lim.titleMin) issues.push(`terlalu pendek (${n} < ${lim.titleMin})`);
  if (n > lim.titleMax) issues.push(`terlalu panjang (${n} > ${lim.titleMax}) - akan ditolak ${lim.label}`);
  else if (n >= lim.titleMin && n < 70) issues.push(`masih bisa dimaksimalkan untuk keyword (${n}/${lim.titleMax} karakter)`);

  const letters = [...name].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length && letters.filter((c) => c === c.toUpperCase()).length / letters.length > 0.6) {
    issues.push("terlalu banyak HURUF KAPITAL");
  }
  if (EMOJI.test(name)) issues.push("mengandung emoji");
  if (SPAM.test(name)) issues.push("mengandung kata promo/spam di judul (berisiko dinilai keyword stuffing)");

  const counts = new Map<string, number>();
  for (const w of name.toLowerCase().match(/\p{L}[\p{L}\p{N}_]*|\p{N}+/gu) ?? []) {
    if (w.length > 2) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const dup = [...counts].filter(([, c]) => c > 2).map(([w]) => w);
  if (dup.length) issues.push(`kata diulang >2x: ${dup.join(", ")}`);
  return issues;
}

export function validateDescription(desc: string, lim: Limits = SHOPEE_LIMITS): string[] {
  const issues: string[] = [];
  const n = desc.trim().length;
  if (n < lim.descMin) issues.push(`deskripsi terlalu pendek (${n} < ${lim.descMin})`);
  if (n > lim.descMax) issues.push(`deskripsi terlalu panjang (${n} > ${lim.descMax}) - akan ditolak ${lim.label}`);
  return issues;
}

/** Pelanggaran keras yang akan membuat Shopee menolak perubahan. */
export function blockingErrors(name?: string, description?: string, lim: Limits = SHOPEE_LIMITS): string[] {
  const errs: string[] = [];
  if (name !== undefined) {
    const n = name.trim().length;
    if (n < lim.titleMin || n > lim.titleMax) errs.push(`nama ${n} karakter, harus ${lim.titleMin}-${lim.titleMax}`);
  }
  if (description !== undefined && description.length > lim.descMax) {
    errs.push(`deskripsi ${description.length} karakter, maks ${lim.descMax}`);
  }
  return errs;
}

export function auditItem(
  item: { item_id: number | string; item_name: string; description?: string },
  lim: Limits = SHOPEE_LIMITS,
) {
  const issues = validateTitle(item.item_name, lim);
  if (item.description) issues.push(...validateDescription(item.description, lim));
  return { item_id: item.item_id, name: item.item_name, name_len: item.item_name.length, issues };
}
