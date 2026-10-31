/**
 * Client read-only untuk Delova Store API v1 (https://delova.id/api/v1): produk, stok, toko.
 * Kunci API dikirim lewat header X-API-Key (kunci di URL ditolak server). Stok bukan realtime:
 * disalin dari Shopee lewat sinkronisasi terjadwal, jadi selalu sertakan umur data (last_sync_at).
 */
export interface StoreApiConfig {
  baseUrl: string;
  apiKey: string;
}

export function loadStoreApiConfig(): StoreApiConfig {
  return {
    baseUrl: (process.env.DELOVA_API_URL || "https://delova.id/api/v1").replace(/\/$/, ""),
    apiKey: process.env.DELOVA_API_KEY ?? "",
  };
}

export class StoreApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(`delova.id API ${status} ${code}: ${message}${requestId ? ` (request_id=${requestId})` : ""}`);
  }
}

type Q = Record<string, string | number | boolean | undefined>;

export async function storeGet(path: string, query: Q = {}, cfg = loadStoreApiConfig()): Promise<any> {
  if (!cfg.apiKey) throw new Error("DELOVA_API_KEY belum diisi di .env server (kunci API delova.id). Isi lalu jalankan ulang container.");
  const u = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(u, { headers: { "X-API-Key": cfg.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch (e) {
    throw new Error(`Tidak bisa menghubungi delova.id: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body: any = await res.json().catch(() => null);
  if (!res.ok) {
    const er = body?.error ?? {};
    const retry = res.status === 429 ? ` Coba lagi dalam ${res.headers.get("retry-after") ?? "beberapa"} detik.` : "";
    throw new StoreApiError(res.status, er.code ?? "error", `${er.message ?? res.statusText}${retry}`, er.request_id);
  }
  return body;
}

/** Peringatan umur data dari meta.last_sync_at. */
export function freshness(lastSyncAt: string | null | undefined, now = Date.now()) {
  if (!lastSyncAt) return { last_sync_at: null, age_hours: null, note: "Waktu sinkron tidak diketahui." };
  const age = Math.max(0, Math.round(((now - Date.parse(lastSyncAt)) / 3_600_000) * 10) / 10);
  return {
    last_sync_at: lastSyncAt,
    age_hours: age,
    note: age > 24 ? `Data stok berumur ${Math.round(age / 24)} hari (bukan realtime); anggap perkiraan dan sinkronkan dulu bila perlu.` : "Data stok masih segar (<24 jam), tapi tetap bukan realtime.",
  };
}

export interface StockAlerts {
  out_of_stock: { product: string; id: string; sku: string | null; variant: string }[];
  low_stock: { product: string; id: string; sku: string | null; variant: string; stock: number }[];
}

/** Telusuri semua halaman /stock lalu kumpulkan varian habis dan menipis (stok <= threshold). */
export async function stockAlerts(q: Q, threshold: number, cfg = loadStoreApiConfig()) {
  const out: StockAlerts = { out_of_stock: [], low_stock: [] };
  let last: string | null = null;
  let products = 0;
  for (let page = 1; page <= 20; page++) {
    const j = await storeGet("/stock", { ...q, page, limit: 200 }, cfg);
    last = j.meta?.last_sync_at ?? last;
    for (const p of j.data ?? []) {
      products++;
      const vs = p.variants?.length ? p.variants : [{ id: p.id, sku: null, name: "(tanpa varian)", stock: p.stock }];
      for (const v of vs) {
        const base = { product: p.name, id: p.id, sku: v.sku ?? null, variant: v.name };
        if (!v.stock || v.stock <= 0) out.out_of_stock.push(base);
        else if (v.stock <= threshold) out.low_stock.push({ ...base, stock: v.stock });
      }
    }
    if (page >= (j.meta?.total_pages ?? 1)) break;
  }
  return { threshold, products_checked: products, ...freshness(last), out_of_stock_count: out.out_of_stock.length, low_stock_count: out.low_stock.length, ...out };
}
