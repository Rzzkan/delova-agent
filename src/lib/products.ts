/** Operasi produk: list, detail, update nama/deskripsi. */
import { ShopeeClient } from "./shopee";

const P = "/api/v2/product";

export interface SlimItem {
  item_id: number;
  item_name: string;
  item_status?: string;
  category_id?: number;
  description_type: "normal" | "extended";
  description: string;
  has_model?: boolean;
}

export async function listItemIds(c: ShopeeClient, shopId: number, status = "NORMAL", offset = 0, pageSize = 50) {
  const r = await c.get(shopId, `${P}/get_item_list`, { offset, page_size: pageSize, item_status: status });
  const resp = r.response ?? {};
  return {
    ids: (resp.item ?? []).map((i: any) => i.item_id as number),
    hasNext: Boolean(resp.has_next_page),
    nextOffset: (resp.next_offset as number | undefined) ?? offset + pageSize,
    total: resp.total_count as number | undefined,
  };
}

export async function getBaseInfo(c: ShopeeClient, shopId: number, ids: number[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await c.get(shopId, `${P}/get_item_base_info`, { item_id_list: chunk.join(",") });
    out.push(...(r.response?.item_list ?? []));
  }
  return out;
}

export function descriptionText(item: any): string {
  if (item.description_type === "extended") {
    const fields = item.description_info?.extended_description?.field_list ?? [];
    return fields
      .filter((f: any) => f.field_type === "text")
      .map((f: any) => f.text ?? "")
      .join("\n");
  }
  return item.description ?? "";
}

export function slim(item: any): SlimItem {
  return {
    item_id: item.item_id,
    item_name: item.item_name ?? "",
    item_status: item.item_status,
    category_id: item.category_id,
    description_type: item.description_type === "extended" ? "extended" : "normal",
    description: descriptionText(item),
    has_model: item.has_model,
  };
}

export async function updateItem(
  c: ShopeeClient,
  shopId: number,
  itemId: number,
  o: { name?: string; description?: string; descriptionType?: "normal" | "extended" },
) {
  const body: Record<string, unknown> = { item_id: itemId };
  if (o.name !== undefined) body.item_name = o.name;
  if (o.description !== undefined) {
    if (o.descriptionType === "extended") {
      body.description_type = "extended";
      body.description_info = {
        extended_description: { field_list: [{ field_type: "text", text: o.description }] },
      };
    } else {
      body.description = o.description;
    }
  }
  return c.post(shopId, `${P}/update_item`, body);
}
