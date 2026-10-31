/**
 * Harga produk untuk daftar dashboard. Parsing toleran terhadap field yang tidak ada.
 * Shopee: price_info[].original_price / current_price (current < original = sedang diskon).
 * TikTok: hanya harga jual per SKU dari pencarian produk; harga coret/promo tidak ada di respons itu.
 */
export interface Price {
  original: number | null; // harga asli (coret)
  current: number | null; // harga yang berlaku (setelah diskon)
  current_max?: number | null; // TikTok: rentang antar SKU
  discount_pct: number | null; // null bila tidak sedang diskon
  variants?: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function discountPct(original: number | null, current: number | null): number | null {
  if (original === null || current === null || original <= 0 || current >= original) return null;
  return Math.round(((original - current) / original) * 100);
}

export function shopeePrice(item: any): Price | undefined {
  const pi = Array.isArray(item?.price_info) ? item.price_info[0] : undefined;
  if (!pi) return undefined;
  const current = num(pi.current_price);
  const original = num(pi.original_price) ?? current;
  return { original, current, discount_pct: discountPct(original, current), ...(item.has_model ? { variants: true } : {}) };
}

export function tiktokPrice(p: any): Price | undefined {
  const prices = (Array.isArray(p?.skus) ? p.skus : []).map((s: any) => num(s?.price?.sale_price)).filter((n: number | null): n is number => n !== null);
  if (!prices.length) return undefined;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { original: null, current: min, current_max: max > min ? max : null, discount_pct: null, variants: prices.length > 1 };
}
