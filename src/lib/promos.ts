/**
 * Ringkasan flash sale mendatang per toko untuk dashboard (Shopee + TikTok Shop).
 * Format respons API ditulis dari dokumentasi dan belum diuji ke toko nyata, jadi parsing dibuat toleran
 * dan kegagalan satu toko tidak menggagalkan toko lain.
 */
import { Config, loadTikTokConfig, tiktokConfigured } from "./config";
import * as flash from "./flashSale";
import type { Platform } from "./queue";
import { ShopeeClient } from "./shopee";
import { TikTokClient } from "./tiktok";
import * as ttPromo from "./tiktokPromo";

export interface PromoEntry {
  id: string;
  title: string | null;
  status: "upcoming" | "ongoing";
  start: number | null; // epoch detik
  end: number | null;
  product_count: number | null;
}
export interface ShopPromos {
  platform: Platform;
  shop_id: string;
  shop_name: string | null;
  entries: PromoEntry[];
  error?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const secs = (v: unknown): number | null => {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : n; // jaga-jaga bila milidetik
};

export function parseShopeeSales(resp: any, status: PromoEntry["status"]): PromoEntry[] {
  const list: any[] = Array.isArray(resp?.flash_sale_list) ? resp.flash_sale_list : [];
  return list.map((f) => ({
    id: String(f.flash_sale_id ?? f.timeslot_id ?? ""),
    title: null,
    status,
    start: secs(f.start_time),
    end: secs(f.end_time),
    product_count: num(f.enabled_item_count ?? f.item_count),
  }));
}

export function parseTikTokActivities(resp: any, status: PromoEntry["status"]): PromoEntry[] {
  const list: any[] = Array.isArray(resp?.activities) ? resp.activities : Array.isArray(resp?.activity_list) ? resp.activity_list : [];
  return list.map((a) => ({
    id: String(a.activity_id ?? a.id ?? ""),
    title: typeof a.title === "string" ? a.title : typeof a.activity_name === "string" ? a.activity_name : null,
    status,
    start: secs(a.begin_time ?? a.start_time),
    end: secs(a.end_time),
    product_count: num(a.product_count ?? a.products_count ?? (Array.isArray(a.products) ? a.products.length : null)),
  }));
}

export function sortEntries(e: PromoEntry[]): PromoEntry[] {
  return [...e].sort((a, b) => (a.status === b.status ? 0 : a.status === "ongoing" ? -1 : 1) || (a.start ?? 0) - (b.start ?? 0));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function upcomingPromos(cfg: Config): Promise<{ generated_at: string; shops: ShopPromos[] }> {
  const ttCfg = loadTikTokConfig();
  const shopee = new ShopeeClient(cfg);
  const tt = new TikTokClient(cfg, ttCfg);
  const [sShops, tShops] = await Promise.all([shopee.shops(), tiktokConfigured(ttCfg) ? tt.shops() : Promise.resolve([])]);

  const jobs: Promise<ShopPromos>[] = [
    ...sShops.map(async (s): Promise<ShopPromos> => {
      const base = { platform: "shopee" as Platform, shop_id: String(s.shop_id), shop_name: s.shop_name ?? null };
      try {
        const [up, on] = await Promise.all([flash.listSales(shopee, s.shop_id, 1), flash.listSales(shopee, s.shop_id, 2)]);
        return { ...base, entries: sortEntries([...parseShopeeSales(on, "ongoing"), ...parseShopeeSales(up, "upcoming")]) };
      } catch (e) {
        return { ...base, entries: [], error: errMsg(e) };
      }
    }),
    ...tShops.map(async (s): Promise<ShopPromos> => {
      const base = { platform: "tiktok" as Platform, shop_id: s.shop_id, shop_name: s.shop_name ?? null };
      try {
        const [up, on] = await Promise.all([
          ttPromo.listActivities(tt, s.shop_id, { status: "NOT_START", type: "FLASH_SALE" }),
          ttPromo.listActivities(tt, s.shop_id, { status: "ONGOING", type: "FLASH_SALE" }),
        ]);
        return { ...base, entries: sortEntries([...parseTikTokActivities(on, "ongoing"), ...parseTikTokActivities(up, "upcoming")]) };
      } catch (e) {
        return { ...base, entries: [], error: errMsg(e) };
      }
    }),
  ];
  const shops = (await Promise.all(jobs)).sort((x, y) => x.platform.localeCompare(y.platform) || x.shop_id.localeCompare(y.shop_id, "en", { numeric: true }));
  return { generated_at: new Date().toISOString(), shops };
}

export type PromosOverview = Awaited<ReturnType<typeof upcomingPromos>>;

/** Cache singkat agar dashboard yang menyegarkan diri tidak menghabiskan rate limit API toko. */
let cache: { at: number; data: PromosOverview } | null = null;
export async function upcomingPromosCached(cfg: Config, force = false, ttlMs = 120_000): Promise<PromosOverview> {
  if (!force && cache && Date.now() - cache.at < ttlMs) return cache.data;
  const data = await upcomingPromos(cfg);
  cache = { at: Date.now(), data };
  return data;
}
export function clearPromosCache() {
  cache = null;
}
