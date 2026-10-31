/**
 * Laporan penjualan, traffic, retur, dan iklan per toko Shopee (read-only).
 *
 * Sumber (Shopee Open Platform v2):
 *  - Penjualan : order/get_order_list + order/get_order_detail (item_list)
 *  - Retur     : returns/get_return_list (item[].amount)
 *  - Traffic   : product/get_item_extra_info (views, sale, likes, rating_star), SEUMUR PRODUK, bukan per periode
 *  - Iklan     : ads/get_all_cpc_ads_daily_performance (iklan CPC toko; GMV Max terpisah)
 * "Konversi" = terjual seumur produk / dilihat seumur produk (pendekatan; Shopee tidak memberi funnel per periode).
 * Tiap bagian gagal terpisah dan dilaporkan di `warnings`, supaya izin yang belum aktif tidak mematikan laporan lain.
 */
import { ShopeeClient } from "./shopee";
import * as sp from "./products";
import { KEYS, getStore } from "./store";

export const WIB = 7 * 3600;
export const dayOf = (sec: number) => new Date((sec + WIB) * 1000).toISOString().slice(0, 10);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const WINDOW = 15 * 86400; // batas jendela waktu per panggilan list Shopee (dibuat konservatif)
const MAX_ORDERS = 3000;

export interface OrderLine { item_id: number; name: string; qty: number; revenue: number }
export interface OrderRec { sn: string; day: string; status: string; total: number; lines: OrderLine[] }
export interface ReturnLine { item_id: number; qty: number; refund: number }
export interface ReturnRec { sn: string; day: string; reason: string; lines: ReturnLine[] }
export interface AdDay { date: string; impressions: number; clicks: number; spend: number; gmv: number; orders: number }
export interface ItemStat { item_id: number; name: string; views: number; sold_lifetime: number; likes: number; rating: number | null; comments: number }

const COUNTED = (s: string) => !["CANCELLED", "UNPAID", "IN_CANCEL", "INVOICE_PENDING"].includes(s);

// ---------- ambil data ----------
export async function fetchOrders(c: ShopeeClient, shopId: number, from: number, to: number) {
  const sns: string[] = [];
  let truncated = false;
  for (let a = from; a < to && !truncated; a += WINDOW) {
    const b = Math.min(a + WINDOW, to);
    let cursor = "";
    for (let guard = 0; guard < 60; guard++) {
      const r = await c.get(shopId, "/api/v2/order/get_order_list", { time_range_field: "create_time", time_from: a, time_to: b, page_size: 100, ...(cursor ? { cursor } : {}) });
      for (const o of r.response?.order_list ?? []) sns.push(String(o.order_sn));
      if (sns.length >= MAX_ORDERS) { truncated = true; break; }
      if (!r.response?.more || !r.response?.next_cursor) break;
      cursor = String(r.response.next_cursor);
    }
  }
  const orders: OrderRec[] = [];
  const uniq = [...new Set(sns)].slice(0, MAX_ORDERS);
  for (let i = 0; i < uniq.length; i += 50) {
    const r = await c.get(shopId, "/api/v2/order/get_order_detail", { order_sn_list: uniq.slice(i, i + 50).join(","), response_optional_fields: "item_list,total_amount" });
    for (const o of r.response?.order_list ?? []) {
      orders.push({
        sn: String(o.order_sn), day: dayOf(num(o.create_time)), status: String(o.order_status ?? ""), total: num(o.total_amount),
        lines: (o.item_list ?? []).map((l: any) => ({ item_id: num(l.item_id), name: String(l.item_name ?? ""), qty: num(l.model_quantity_purchased), revenue: num(l.model_discounted_price) * num(l.model_quantity_purchased) })),
      });
    }
  }
  return { orders, truncated: truncated || sns.length > MAX_ORDERS };
}

export async function fetchReturns(c: ShopeeClient, shopId: number, from: number, to: number): Promise<ReturnRec[]> {
  const out: ReturnRec[] = [];
  for (let a = from; a < to; a += WINDOW) {
    const b = Math.min(a + WINDOW, to);
    for (let page = 0; page < 20; page++) {
      const r = await c.get(shopId, "/api/v2/returns/get_return_list", { page_no: page, page_size: 50, create_time_from: a, create_time_to: b });
      for (const x of r.response?.return ?? []) {
        out.push({ sn: String(x.return_sn), day: dayOf(num(x.create_time)), reason: String(x.reason ?? ""), lines: (x.item ?? []).map((i: any) => ({ item_id: num(i.item_id), qty: Math.max(1, num(i.amount)), refund: num(i.item_price) * Math.max(1, num(i.amount)) })) });
      }
      if (!r.response?.more) break;
    }
  }
  return out;
}

const ddmmyyyy = (sec: number) => { const [y, m, d] = dayOf(sec).split("-"); return `${d}-${m}-${y}`; };
export async function fetchAds(c: ShopeeClient, shopId: number, from: number, to: number): Promise<AdDay[]> {
  const out: AdDay[] = [];
  for (let a = from; a < to; a += 30 * 86400) {
    const b = Math.min(a + 30 * 86400, to);
    if (ddmmyyyy(a) === ddmmyyyy(b)) continue; // Shopee menolak rentang satu hari
    const r = await c.get(shopId, "/api/v2/ads/get_all_cpc_ads_daily_performance", { start_date: ddmmyyyy(a), end_date: ddmmyyyy(b) });
    out.push(...parseAds(r.response));
  }
  return out;
}
/** Toleran: response bisa berupa array harian atau objek berisi daftar. */
export function parseAds(resp: any): AdDay[] {
  const list: any[] = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : Array.isArray(resp?.list) ? resp.list : [];
  return list.map((r) => ({
    date: String(r.date ?? ""), impressions: num(r.impression ?? r.impressions), clicks: num(r.clicks),
    spend: num(r.expense ?? r.spend), gmv: num(r.broad_order_amount ?? r.broad_gmv ?? r.direct_order_amount), orders: num(r.broad_order ?? r.orders),
  }));
}

export async function fetchItemStats(c: ShopeeClient, shopId: number): Promise<ItemStat[]> {
  const ids: number[] = [];
  for (let off = 0, g = 0; g < 10; g++) {
    const r = await sp.listItemIds(c, shopId, "NORMAL", off, 100);
    ids.push(...r.ids);
    if (!r.hasNext) break;
    off = r.nextOffset;
  }
  const names = new Map((await sp.getBaseInfo(c, shopId, ids)).map((i) => [num(i.item_id), String(i.item_name ?? "")]));
  const out: ItemStat[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await c.get(shopId, "/api/v2/product/get_item_extra_info", { item_id_list: ids.slice(i, i + 50).join(",") });
    for (const x of r.response?.item_list ?? []) {
      out.push({ item_id: num(x.item_id), name: names.get(num(x.item_id)) ?? "", views: num(x.views), sold_lifetime: num(x.sale), likes: num(x.likes), rating: x.rating_star == null ? null : num(x.rating_star), comments: num(x.comment_count) });
    }
  }
  return out;
}

// ---------- hitung (murni) ----------
export interface ProductRow {
  item_id: number; name: string;
  units: number; revenue: number; orders: number;
  return_units: number; return_rate: number | null; return_reasons: string[];
  views: number; sold_lifetime: number; conversion: number | null; likes: number; rating: number | null;
}

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function buildProducts(orders: OrderRec[], returns: ReturnRec[], stats: ItemStat[]): ProductRow[] {
  const rows = new Map<number, ProductRow>();
  const row = (id: number, name = ""): ProductRow => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { item_id: id, name, units: 0, revenue: 0, orders: 0, return_units: 0, return_rate: null, return_reasons: [], views: 0, sold_lifetime: 0, conversion: null, likes: 0, rating: null }));
    if (!r.name && name) r.name = name;
    return r;
  };
  for (const s of stats) { const r = row(s.item_id, s.name); r.views = s.views; r.sold_lifetime = s.sold_lifetime; r.likes = s.likes; r.rating = s.rating; r.conversion = s.views > 0 ? s.sold_lifetime / s.views : null; }
  for (const o of orders) {
    if (!COUNTED(o.status)) continue;
    for (const l of o.lines) { const r = row(l.item_id, l.name); r.units += l.qty; r.revenue += l.revenue; r.orders += 1; }
  }
  const reasons = new Map<number, Map<string, number>>();
  for (const x of returns) for (const l of x.lines) {
    row(l.item_id).return_units += l.qty;
    const m = reasons.get(l.item_id) ?? new Map<string, number>();
    if (x.reason) m.set(x.reason, (m.get(x.reason) ?? 0) + 1);
    reasons.set(l.item_id, m);
  }
  for (const r of rows.values()) {
    r.return_rate = r.units > 0 ? r.return_units / r.units : null;
    r.return_reasons = [...(reasons.get(r.item_id) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  }
  return [...rows.values()];
}

/** Traffic bagus (views di persentil atas, min 100) tetapi konversi di bawah median toko. Urut: views terbesar. */
export function trafficLowConversion(rows: ProductRow[], limit = 10) {
  const eligible = rows.filter((r) => r.views >= 100 && r.conversion !== null);
  if (eligible.length < 4) return { median_conversion: null as number | null, rows: [] as (ProductRow & { potential_orders: number })[] };
  const med = median(eligible.map((r) => r.conversion!));
  const viewCut = Math.max(100, [...eligible.map((r) => r.views)].sort((a, b) => a - b)[Math.floor(eligible.length * 0.6)]);
  const flagged = eligible
    .filter((r) => r.views >= viewCut && r.conversion! < med)
    .map((r) => ({ ...r, potential_orders: Math.round(r.views * (med - r.conversion!)) }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
  return { median_conversion: med, rows: flagged };
}

/** Retur tertinggi: urut jumlah unit retur, lalu rasio. Rasio hanya bermakna bila ada penjualan di periode. */
export function topReturns(rows: ProductRow[], limit = 10) {
  return rows.filter((r) => r.return_units > 0).sort((a, b) => b.return_units - a.return_units || (b.return_rate ?? 0) - (a.return_rate ?? 0)).slice(0, limit);
}
export const topSellers = (rows: ProductRow[], limit = 10) => rows.filter((r) => r.units > 0).sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, limit);

export function summarize(orders: OrderRec[], returns: ReturnRec[], ads: AdDay[]) {
  const counted = orders.filter((o) => COUNTED(o.status));
  const revenue = counted.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.revenue, 0), 0);
  const units = counted.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty, 0), 0);
  const returnUnits = returns.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.qty, 0), 0);
  const spend = ads.reduce((s, a) => s + a.spend, 0);
  const adGmv = ads.reduce((s, a) => s + a.gmv, 0);
  const byDay = new Map<string, { day: string; orders: number; revenue: number; ad_spend: number }>();
  const d = (k: string) => { let x = byDay.get(k); if (!x) byDay.set(k, (x = { day: k, orders: 0, revenue: 0, ad_spend: 0 })); return x; };
  for (const o of counted) { const x = d(o.day); x.orders++; x.revenue += o.lines.reduce((a, l) => a + l.revenue, 0); }
  for (const a of ads) { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(a.date); d(m ? `${m[3]}-${m[2]}-${m[1]}` : a.date).ad_spend += a.spend; }
  return {
    orders: counted.length, cancelled: orders.length - counted.length, units, revenue,
    aov: counted.length ? Math.round(revenue / counted.length) : 0,
    return_count: returns.length, return_units: returnUnits, return_rate: units ? returnUnits / units : null,
    ad_spend: spend, ad_gmv: adGmv, roas: spend > 0 ? adGmv / spend : null, acos: adGmv > 0 ? spend / adGmv : null,
    tacos: revenue > 0 && spend > 0 ? spend / revenue : null,
    ad_impressions: ads.reduce((s, a) => s + a.impressions, 0), ad_clicks: ads.reduce((s, a) => s + a.clicks, 0),
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ---------- laporan lengkap ----------
export interface Report {
  generated_at: string; shop_id: string; shop_name: string | null; days: number; from: string; to: string;
  summary: ReturnType<typeof summarize>;
  top_sellers: ProductRow[];
  traffic_low_conversion: ReturnType<typeof trafficLowConversion>;
  top_returns: ProductRow[];
  warnings: string[]; truncated: boolean;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 220);
const TTL_MS = 30 * 60 * 1000;

export async function buildReport(c: ShopeeClient, shopId: number, days: number, o: { force?: boolean; now?: number } = {}): Promise<Report> {
  const key = `${shopId}:${days}`;
  const store = getStore();
  const hit = await store.hget<{ t: number; report: Report }>(KEYS.analytics, key);
  if (!o.force && hit && Date.now() - hit.t < TTL_MS) return hit.report;

  const to = Math.floor((o.now ?? Date.now()) / 1000);
  const from = to - days * 86400;
  const warnings: string[] = [];
  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) { warnings.push(`${label}: ${errText(e)}`); return fallback; }
  };
  const [ord, returns, ads, stats, shops] = await Promise.all([
    safe("Pesanan", () => fetchOrders(c, shopId, from, to), { orders: [] as OrderRec[], truncated: false }),
    safe("Retur", () => fetchReturns(c, shopId, from, to), [] as ReturnRec[]),
    safe("Iklan", () => fetchAds(c, shopId, from, to), [] as AdDay[]),
    safe("Traffic produk", () => fetchItemStats(c, shopId), [] as ItemStat[]),
    c.shops(),
  ]);
  const products = buildProducts(ord.orders, returns, stats);
  const report: Report = {
    generated_at: new Date().toISOString(), shop_id: String(shopId), shop_name: shops.find((s) => s.shop_id === shopId)?.shop_name ?? null,
    days, from: dayOf(from), to: dayOf(to),
    summary: summarize(ord.orders, returns, ads),
    top_sellers: topSellers(products), traffic_low_conversion: trafficLowConversion(products), top_returns: topReturns(products),
    warnings, truncated: ord.truncated,
  };
  if (!warnings.length || warnings.length < 4) await store.hset(KEYS.analytics, key, { t: Date.now(), report });
  return report;
}
