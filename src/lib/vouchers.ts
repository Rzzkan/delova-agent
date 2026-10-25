/**
 * Voucher aktif per toko untuk dashboard (Shopee: modul /api/v2/voucher).
 * TikTok Shop belum didukung: endpoint kupon-nya belum terverifikasi, jadi tidak ditebak.
 * Parsing toleran; kegagalan satu toko tidak menggagalkan toko lain.
 */
import { Config } from "./config";
import { ShopeeClient } from "./shopee";

export interface VoucherEntry {
  id: string;
  code: string | null;
  name: string | null;
  scope: "toko" | "produk" | null;
  reward: "nominal" | "persen" | "koin" | null;
  amount: number | null; // rupiah (nominal) atau persen
  min_spend: number | null;
  quota: number | null;
  used: number | null;
  start: number | null;
  end: number | null;
}
export interface ShopVouchers {
  shop_id: string;
  shop_name: string | null;
  vouchers: VoucherEntry[];
  truncated?: boolean;
  error?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const secs = (v: unknown): number | null => {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : n;
};

export function parseShopeeVouchers(resp: any): VoucherEntry[] {
  const list: any[] = Array.isArray(resp?.voucher_list) ? resp.voucher_list : [];
  return list.map((v) => {
    const rt = num(v.reward_type);
    const pct = num(v.percentage);
    const reward: VoucherEntry["reward"] = rt === 2 || (rt === null && pct) ? "persen" : rt === 3 ? "koin" : rt === 1 || num(v.discount_amount) ? "nominal" : null;
    return {
      id: String(v.voucher_id ?? ""),
      code: typeof v.voucher_code === "string" ? v.voucher_code : null,
      name: typeof v.voucher_name === "string" ? v.voucher_name : null,
      scope: num(v.voucher_type) === 1 ? "toko" : num(v.voucher_type) === 2 ? "produk" : null,
      reward,
      amount: reward === "persen" ? pct : num(v.discount_amount),
      min_spend: num(v.min_basket_price),
      quota: num(v.usage_quantity),
      used: num(v.current_usage),
      start: secs(v.start_time),
      end: secs(v.end_time),
    };
  });
}

/** Voucher yang paling cepat berakhir di atas. */
export function sortVouchers(v: VoucherEntry[]): VoucherEntry[] {
  return [...v].sort((a, b) => (a.end ?? Infinity) - (b.end ?? Infinity));
}

const MAX_PAGES = 3;
const PAGE = 100;

export async function activeVouchers(cfg: Config): Promise<{ generated_at: string; tiktok_supported: false; shops: ShopVouchers[] }> {
  const c = new ShopeeClient(cfg);
  const shops = await Promise.all(
    (await c.shops()).map(async (s): Promise<ShopVouchers> => {
      const base = { shop_id: String(s.shop_id), shop_name: s.shop_name ?? null };
      try {
        const all: VoucherEntry[] = [];
        let truncated = false;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const r = await c.get(s.shop_id, "/api/v2/voucher/get_voucher_list", { status: "ongoing", page_no: page, page_size: PAGE });
          all.push(...parseShopeeVouchers(r.response));
          if (!r.response?.more) break;
          if (page === MAX_PAGES) truncated = true;
        }
        return { ...base, vouchers: sortVouchers(all), ...(truncated ? { truncated } : {}) };
      } catch (e) {
        return { ...base, vouchers: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
      }
    }),
  );
  shops.sort((x, y) => x.shop_id.localeCompare(y.shop_id, "en", { numeric: true }));
  return { generated_at: new Date().toISOString(), tiktok_supported: false, shops };
}

export type VouchersOverview = Awaited<ReturnType<typeof activeVouchers>>;

let cache: { at: number; data: VouchersOverview } | null = null;
export async function activeVouchersCached(cfg: Config, force = false, ttlMs = 120_000): Promise<VouchersOverview> {
  if (!force && cache && Date.now() - cache.at < ttlMs) return cache.data;
  const data = await activeVouchers(cfg);
  cache = { at: Date.now(), data };
  return data;
}
