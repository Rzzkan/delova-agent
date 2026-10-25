/**
 * Promosi TikTok Shop (API 202309): diskon langsung, harga tetap, dan flash sale.
 * Path & field ditulis dari dokumentasi Partner Center namun BELUM diuji ke toko nyata; selalu mulai dari dry_run.
 */
import { TikTokClient } from "./tiktok";

export type ActivityType = "DIRECT_DISCOUNT" | "FIXED_PRICE" | "FLASH_SALE";
export const ACTIVITY_TYPES: ActivityType[] = ["DIRECT_DISCOUNT", "FIXED_PRICE", "FLASH_SALE"];
const TITLE_MAX = 50;
export const MAX_PROMO_PRODUCTS = 50;

export interface PromoSku {
  id: string;
  activity_price_amount?: string | number;
  discount_percent?: number;
  quantity_limit?: number;
  quantity_per_user?: number;
}
export interface PromoProduct extends PromoSku {
  skus?: PromoSku[];
}
export interface PromoInput {
  title: string;
  activity_type: ActivityType;
  begin_time: number; // epoch detik
  end_time: number;
  products: PromoProduct[];
}

/** Validasi lokal sebelum menyentuh API. */
export function validatePromo(p: PromoInput, nowSec = Math.floor(Date.now() / 1000)): string[] {
  const e: string[] = [];
  const t = p.title.trim();
  if (!t) e.push("judul kosong");
  if (t.length > TITLE_MAX) e.push(`judul ${t.length} karakter, maks ${TITLE_MAX}`);
  if (!ACTIVITY_TYPES.includes(p.activity_type)) e.push(`activity_type harus salah satu dari ${ACTIVITY_TYPES.join(", ")}`);
  if (p.begin_time <= nowSec) e.push("begin_time harus di masa depan");
  if (p.end_time <= p.begin_time) e.push("end_time harus setelah begin_time");
  if (!p.products.length) e.push("tidak ada produk");
  if (p.products.length > MAX_PROMO_PRODUCTS) e.push(`maks ${MAX_PROMO_PRODUCTS} produk per panggilan`);
  const seen = new Set<string>();
  for (const pr of p.products) {
    if (seen.has(pr.id)) e.push(`produk ${pr.id} duplikat`);
    seen.add(pr.id);
    const levels: PromoSku[] = pr.skus?.length ? pr.skus : [pr];
    for (const l of levels) e.push(...validateLevel(p.activity_type, l, pr.id));
  }
  return e;
}

function validateLevel(type: ActivityType, l: PromoSku, productId: string): string[] {
  const e: string[] = [];
  const where = `produk ${productId}${l.id !== productId ? ` / sku ${l.id}` : ""}`;
  const price = l.activity_price_amount === undefined ? undefined : Number(l.activity_price_amount);
  if (type === "DIRECT_DISCOUNT") {
    if (l.discount_percent === undefined) e.push(`${where}: discount_percent wajib untuk DIRECT_DISCOUNT`);
    else if (!(l.discount_percent > 0 && l.discount_percent < 100)) e.push(`${where}: discount_percent harus antara 0 dan 100`);
  } else {
    if (price === undefined || !(price > 0)) e.push(`${where}: activity_price_amount wajib (> 0) untuk ${type}`);
  }
  if (type === "FLASH_SALE") {
    if (!l.quantity_limit || l.quantity_limit < 1) e.push(`${where}: quantity_limit wajib untuk FLASH_SALE`);
    if (!l.quantity_per_user || l.quantity_per_user < 1) e.push(`${where}: quantity_per_user wajib untuk FLASH_SALE`);
  }
  return e;
}

const levelBody = (l: PromoSku) => ({
  id: l.id,
  ...(l.activity_price_amount !== undefined ? { activity_price_amount: String(l.activity_price_amount) } : {}),
  ...(l.discount_percent !== undefined ? { discount: String(l.discount_percent) } : {}),
  ...(l.quantity_limit !== undefined ? { quantity_limit: l.quantity_limit } : {}),
  ...(l.quantity_per_user !== undefined ? { quantity_per_user: l.quantity_per_user } : {}),
});

export function productsBody(items: PromoProduct[]) {
  return {
    products: items.map((p) => ({
      ...levelBody(p),
      ...(p.skus?.length ? { skus: p.skus.map(levelBody) } : {}),
    })),
  };
}

const P = "/promotion/202309/activities";

export async function listActivities(
  c: TikTokClient,
  shopId: string,
  o: { status?: string; type?: ActivityType; pageToken?: string; pageSize?: number } = {},
) {
  const body: Record<string, unknown> = {};
  if (o.status) body.status = o.status;
  if (o.type) body.activity_type = o.type;
  return c.call("POST", `${P}/search`, { shopId, query: { page_size: o.pageSize ?? 20, page_token: o.pageToken }, body });
}

export const getActivity = (c: TikTokClient, shopId: string, id: string) =>
  c.call("GET", `${P}/${encodeURIComponent(id)}`, { shopId });

export async function createActivity(c: TikTokClient, shopId: string, p: PromoInput) {
  const d = await c.call("POST", P, {
    shopId,
    body: {
      title: p.title.trim(),
      activity_type: p.activity_type,
      begin_time: p.begin_time,
      end_time: p.end_time,
      product_level: p.products.some((x) => x.skus?.length) ? "VARIATION" : "PRODUCT",
    },
  });
  return { activity_id: String(d.activity_id ?? d.id ?? ""), raw: d };
}

export const addProducts = (c: TikTokClient, shopId: string, activityId: string, items: PromoProduct[]) =>
  c.call("POST", `${P}/${encodeURIComponent(activityId)}/products`, { shopId, body: productsBody(items) });

export const removeProducts = (c: TikTokClient, shopId: string, activityId: string, productIds: string[]) =>
  c.call("DELETE", `${P}/${encodeURIComponent(activityId)}/products`, { shopId, body: { product_ids: productIds } });

export const deactivate = (c: TikTokClient, shopId: string, activityId: string) =>
  c.call("POST", `${P}/${encodeURIComponent(activityId)}/deactivate`, { shopId, body: {} });
