/** Aturan SEO produk Shopee (judul & deskripsi). Murni lokal, tanpa API. */

export const TITLE_MIN = 20;
export const TITLE_MAX = 120; // batas Shopee untuk nama produk
export const DESC_MIN = 100;
export const DESC_MAX = 3000; // batas deskripsi

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const SPAM = /(!!+|\*{2,}|#{2,}|\bpromo\b|\bmurah banget\b|\bdiskon\b|\bsale\b|\bready stock\b)/i;

export function validateTitle(name: string): string[] {
  const issues: string[] = [];
  const n = name.trim().length;
  if (n < TITLE_MIN) issues.push(`terlalu pendek (${n} < ${TITLE_MIN})`);
  if (n > TITLE_MAX) issues.push(`terlalu panjang (${n} > ${TITLE_MAX}) - akan ditolak Shopee`);
  else if (n >= TITLE_MIN && n < 70) issues.push(`masih bisa dimaksimalkan untuk keyword (${n}/${TITLE_MAX} karakter)`);

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

export function validateDescription(desc: string): string[] {
  const issues: string[] = [];
  const n = desc.trim().length;
  if (n < DESC_MIN) issues.push(`deskripsi terlalu pendek (${n} < ${DESC_MIN})`);
  if (n > DESC_MAX) issues.push(`deskripsi terlalu panjang (${n} > ${DESC_MAX}) - akan ditolak Shopee`);
  return issues;
}

/** Pelanggaran keras yang akan membuat Shopee menolak perubahan. */
export function blockingErrors(name?: string, description?: string): string[] {
  const errs: string[] = [];
  if (name !== undefined) {
    const n = name.trim().length;
    if (n < TITLE_MIN || n > TITLE_MAX) errs.push(`nama ${n} karakter, harus ${TITLE_MIN}-${TITLE_MAX}`);
  }
  if (description !== undefined && description.length > DESC_MAX) {
    errs.push(`deskripsi ${description.length} karakter, maks ${DESC_MAX}`);
  }
  return errs;
}

export function auditItem(item: { item_id: number; item_name: string; description?: string }) {
  const issues = validateTitle(item.item_name);
  if (item.description) issues.push(...validateDescription(item.description));
  return { item_id: item.item_id, name: item.item_name, name_len: item.item_name.length, issues };
}
