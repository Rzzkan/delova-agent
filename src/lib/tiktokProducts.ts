/** Operasi produk TikTok Shop (API 202309): cari, detail, edit judul/deskripsi. ID selalu string. */
import { TikTokClient } from "./tiktok";

export interface TTSlim {
  item_id: string;
  item_name: string;
  item_status?: string;
  description: string; // HTML dari TikTok
}

export const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function searchProducts(c: TikTokClient, shopId: string, o: { status?: string; pageToken?: string; pageSize?: number } = {}) {
  const d = await c.call("POST", "/product/202309/products/search", {
    shopId,
    query: { page_size: o.pageSize ?? 20, page_token: o.pageToken },
    body: o.status ? { status: o.status } : {},
  });
  return {
    items: (d.products ?? []).map((p: any) => ({ item_id: String(p.id), item_name: String(p.title ?? ""), item_status: p.status as string | undefined })),
    nextPageToken: (d.next_page_token as string | undefined) || undefined,
    total: d.total_count as number | undefined,
  };
}

export async function getProduct(c: TikTokClient, shopId: string, id: string): Promise<TTSlim> {
  const d = await c.call("GET", `/product/202309/products/${encodeURIComponent(id)}`, { shopId });
  return { item_id: String(d.id ?? id), item_name: String(d.title ?? ""), item_status: d.status, description: String(d.description ?? "") };
}

/** Ambil beberapa produk satu per satu (TikTok tidak punya get massal); produk yang tidak ada dilewati. */
export async function getMany(c: TikTokClient, shopId: string, ids: string[]): Promise<TTSlim[]> {
  const out: TTSlim[] = [];
  for (const id of ids) {
    try {
      out.push(await getProduct(c, shopId, id));
    } catch (e: any) {
      if (/not.?found|does not exist|invalid.*product/i.test(String(e?.detail ?? e?.message))) continue;
      throw e;
    }
  }
  return out;
}

export async function updateProduct(c: TikTokClient, shopId: string, id: string, o: { name?: string; description?: string }) {
  const body: Record<string, unknown> = {};
  if (o.name !== undefined) body.title = o.name;
  if (o.description !== undefined) body.description = o.description;
  return c.call("POST", `/product/202309/products/${encodeURIComponent(id)}/partial_edit`, { shopId, body });
}
