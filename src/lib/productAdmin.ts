/**
 * Baca produk (+ skor SEO) untuk dashboard, dan tulis nama/deskripsi hanya lewat persetujuan (proposals.ts).
 * Cakupan sengaja dibatasi ke nama + deskripsi (hal yang menunjang SEO). Membuat produk baru
 * (kategori, gambar, logistik, varian) tidak termasuk.
 *
 * Pengaman: validasi SEO per platform, backup nilai lama sebelum edit/hapus (bisa dipulihkan),
 * hapus wajib konfirmasi dengan mengetik nama produk, dan mengikuti SHOPEE_READ_ONLY (di client).
 * Endpoint hapus dan pencarian belum diuji ke API asli; gagalnya akan tampil apa adanya.
 */
import { randomBytes } from "node:crypto";
import * as seo from "./seo";
import * as sp from "./products";
import * as tp from "./tiktokProducts";
import { ShopeeClient } from "./shopee";
import { TikTokClient } from "./tiktok";
import { Score, combined, scoreDescription, scoreTitle } from "./scoring";
import { KEYS, getStore } from "./store";

export type Platform = "shopee" | "tiktok";

export interface ProductRow {
  id: string;
  name: string;
  status: string | null;
  title_score?: number;
  title_grade?: string;
}
export interface ProductDetail extends ProductRow {
  description: string; // Shopee: teks; TikTok: HTML
  description_format: "teks" | "html";
  limits: seo.Limits;
  issues: string[];
  title: Score;
  desc: Score;
  total: number;
}
export interface ProductPage {
  items: ProductRow[];
  next: string | null; // Shopee: offset, TikTok: page token
  total: number | null;
}
export interface LogEntry {
  id: string;
  kind: "edit" | "hapus" | "pulihkan";
  platform: Platform;
  shop_id: string;
  product_id: string;
  created_at: string;
  name: string; // nilai LAMA (sebelum aksi)
  description: string;
  description_type?: "normal" | "extended";
  note?: string;
}

export const limitsFor = (p: Platform) => (p === "shopee" ? seo.SHOPEE_LIMITS : seo.TIKTOK_LIMITS);
const PAGE = 20;
const SH = seo.SHOPEE_LIMITS;
function withScore(r: ProductRow, lim: seo.Limits): ProductRow {
  const t = scoreTitle(r.name, lim);
  return { ...r, title_score: t.score, title_grade: t.grade };
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- daftar ----------
export async function listProducts(
  clients: { shopee?: ShopeeClient; tiktok?: TikTokClient },
  platform: Platform,
  shopId: string,
  o: { status?: string; cursor?: string; q?: string } = {},
): Promise<ProductPage> {
  if (platform === "shopee") {
    const c = need(clients.shopee, "Shopee");
    const sid = Number(shopId);
    const offset = Number(o.cursor ?? 0) || 0;
    const status = o.status || "NORMAL";
    let ids: number[];
    let next: string | null;
    let total: number | null = null;
    if (o.q?.trim()) {
      const r = await c.get(sid, "/api/v2/product/search_item", { offset, page_size: PAGE, item_name: o.q.trim(), item_status: status });
      ids = (r.response?.item_id_list ?? []).map(Number);
      total = (r.response?.total_count as number | undefined) ?? null;
      next = r.response?.has_next_page ? String(r.response?.next_offset ?? offset + PAGE) : null;
    } else {
      const r = await sp.listItemIds(c, sid, status, offset, PAGE);
      ids = r.ids;
      total = r.total ?? null;
      next = r.hasNext ? String(r.nextOffset) : null;
    }
    const info = ids.length ? await sp.getBaseInfo(c, sid, ids) : [];
    const byId = new Map(info.map((i) => [Number(i.item_id), i]));
    const items = ids.flatMap((id) => {
      const i = byId.get(id);
      return i ? [withScore({ id: String(id), name: String(i.item_name ?? ""), status: (i.item_status as string) ?? null }, SH)] : [];
    });
    return { items, next, total };
  }
  const c = need(clients.tiktok, "TikTok");
  const r = await tp.searchProducts(c, shopId, { status: o.status || undefined, pageToken: o.cursor || undefined, pageSize: PAGE });
  const q = o.q?.trim().toLowerCase();
  const items = r.items
    .filter((i: { item_name: string }) => !q || i.item_name.toLowerCase().includes(q))
    .map((i: { item_id: string; item_name: string; item_status?: string }) => withScore({ id: i.item_id, name: i.item_name, status: i.item_status ?? null }, seo.TIKTOK_LIMITS));
  return { items, next: r.nextPageToken ?? null, total: r.total ?? null };
}

function need<T>(c: T | undefined, label: string): T {
  if (!c) throw new Error(`${label} belum dikonfigurasi.`);
  return c;
}

// ---------- detail ----------
export async function getDetail(
  clients: { shopee?: ShopeeClient; tiktok?: TikTokClient },
  platform: Platform,
  shopId: string,
  id: string,
): Promise<ProductDetail> {
  const limits = limitsFor(platform);
  if (platform === "shopee") {
    const [raw] = await sp.getBaseInfo(need(clients.shopee, "Shopee"), Number(shopId), [Number(id)]);
    if (!raw) throw new Error("Produk tidak ditemukan.");
    const s = sp.slim(raw);
    const title = scoreTitle(s.item_name, limits);
    const desc = scoreDescription(s.description, limits);
    return { id: String(s.item_id), name: s.item_name, status: s.item_status ?? null, description: s.description, description_format: "teks", limits, issues: seo.auditItem(s, limits).issues, title, desc, total: combined(title, desc) };
  }
  const t = await tp.getProduct(need(clients.tiktok, "TikTok"), shopId, id);
  const plain = tp.strip(t.description);
  const title = scoreTitle(t.item_name, limits);
  const desc = scoreDescription(plain, limits);
  return {
    id: t.item_id, name: t.item_name, status: t.item_status ?? null, description: t.description, description_format: "html", limits,
    issues: seo.auditItem({ item_id: t.item_id, item_name: t.item_name, description: plain }, limits).issues,
    title, desc, total: combined(title, desc),
  };
}

// ---------- log/backup ----------
async function log(e: Omit<LogEntry, "id" | "created_at">): Promise<string> {
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  await getStore().hset(KEYS.productLog, id, { ...e, id, created_at: new Date().toISOString() });
  return id;
}

export async function listLog(platform: Platform, shopId: string, productId?: string): Promise<LogEntry[]> {
  const all = Object.values(await getStore().hgetall<LogEntry>(KEYS.productLog));
  return all
    .filter((e) => e.platform === platform && e.shop_id === shopId && (!productId || e.product_id === productId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30);
}

// ---------- edit ----------
export interface EditInput {
  name?: string;
  description?: string;
}

/** Cek tanpa menulis: kembalikan kesalahan keras + saran SEO. */
export function checkEdit(platform: Platform, e: EditInput) {
  const lim = limitsFor(platform);
  const plain = e.description === undefined ? undefined : platform === "tiktok" ? tp.strip(e.description) : e.description;
  const errors = seo.blockingErrors(e.name, plain, lim);
  if (e.description !== undefined && plain !== undefined && plain.trim().length < lim.descMin) errors.push(`deskripsi ${plain.trim().length} karakter, minimal ${lim.descMin}`);
  const hard = /terlalu (pendek|panjang)/;
  const warnings = [...(e.name !== undefined ? seo.validateTitle(e.name, lim) : []), ...(plain !== undefined ? seo.validateDescription(plain, lim) : [])].filter((w) => !hard.test(w));
  return { errors, warnings };
}

export async function editProduct(
  clients: { shopee?: ShopeeClient; tiktok?: TikTokClient },
  platform: Platform,
  shopId: string,
  id: string,
  e: EditInput,
) {
  if (e.name === undefined && e.description === undefined) throw new Error("Tidak ada perubahan.");
  const chk = checkEdit(platform, e);
  if (chk.errors.length) throw new Error(`Perubahan ditolak: ${chk.errors.join("; ")}`);
  const cur = await getDetail(clients, platform, shopId, id);
  const type = platform === "shopee" ? await shopeeDescType(clients.shopee!, Number(shopId), Number(id)) : undefined;
  const backupId = await log({ kind: "edit", platform, shop_id: shopId, product_id: id, name: cur.name, description: cur.description, ...(type ? { description_type: type } : {}) });
  try {
    await write(clients, platform, shopId, id, { name: e.name, description: e.description, type });
  } catch (err) {
    throw new Error(`Gagal memperbarui produk: ${errText(err)} (backup ${backupId} tersimpan, produk tidak berubah)`);
  }
  return { backup_id: backupId, warnings: chk.warnings };
}

async function shopeeDescType(c: ShopeeClient, shopId: number, id: number): Promise<"normal" | "extended"> {
  const [raw] = await sp.getBaseInfo(c, shopId, [id]);
  return raw?.description_type === "extended" ? "extended" : "normal";
}

async function write(
  clients: { shopee?: ShopeeClient; tiktok?: TikTokClient },
  platform: Platform,
  shopId: string,
  id: string,
  o: { name?: string; description?: string; type?: "normal" | "extended" },
) {
  if (platform === "shopee") {
    await sp.updateItem(need(clients.shopee, "Shopee"), Number(shopId), Number(id), { name: o.name, description: o.description, descriptionType: o.type });
  } else {
    await tp.updateProduct(need(clients.tiktok, "TikTok"), shopId, id, { name: o.name, description: o.description });
  }
}

// ---------- pulihkan ----------
export async function restore(clients: { shopee?: ShopeeClient; tiktok?: TikTokClient }, logId: string) {
  const e = await getStore().hget<LogEntry>(KEYS.productLog, logId);
  if (!e) throw new Error("Backup tidak ditemukan.");
  if (e.kind === "hapus") throw new Error("Produk yang sudah dihapus tidak bisa dipulihkan lewat sini; buat ulang produk di Seller Center (nama & deskripsi lama ada di riwayat).");
  const cur = await getDetail(clients, e.platform, e.shop_id, e.product_id);
  const backupId = await log({ kind: "pulihkan", platform: e.platform, shop_id: e.shop_id, product_id: e.product_id, name: cur.name, description: cur.description, description_type: e.description_type, note: `memulihkan ${logId}` });
  await write(clients, e.platform, e.shop_id, e.product_id, { name: e.name, description: e.description, type: e.description_type });
  return { backup_id: backupId, restored: logId };
}

// ---------- util untuk route ----------
import { Config, loadTikTokConfig, tiktokConfigured } from "./config";

export function makeClients(cfg: Config) {
  const ttCfg = loadTikTokConfig();
  return { shopee: new ShopeeClient(cfg), tiktok: tiktokConfigured(ttCfg) ? new TikTokClient(cfg, ttCfg) : undefined };
}

export async function productShops(clients: { shopee?: ShopeeClient; tiktok?: TikTokClient }, platform: Platform) {
  if (platform === "shopee") return (await need(clients.shopee, "Shopee").shops()).map((s) => ({ shop_id: String(s.shop_id), shop_name: s.shop_name ?? null }));
  if (!clients.tiktok) return [];
  return (await clients.tiktok.shops()).map((s: any) => ({ shop_id: String(s.shop_id), shop_name: (s.shop_name as string | undefined) ?? null }));
}
