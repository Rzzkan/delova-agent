/**
 * Shop Flash Sale (modul /api/v2/shop_flash_sale).
 * Nama field mengikuti dokumentasi Shopee Open Platform; verifikasi di sandbox sebelum dipakai massal.
 */
import { ShopeeClient } from "./shopee";

const F = "/api/v2/shop_flash_sale";
const now = () => Math.floor(Date.now() / 1000);

export interface FlashItem {
  item_id: number;
  purchase_limit: number;
  item_input_promotion_price?: number;
  item_stock?: number;
  models?: { model_id: number; input_promotion_price: number; stock: number }[];
}

export async function timeSlots(c: ShopeeClient, shopId: number, daysAhead = 7) {
  const r = await c.get(shopId, `${F}/get_time_slot_id`, {
    start_time: now(),
    end_time: now() + daysAhead * 86400,
  });
  return r.response ?? [];
}

/** kind: 0 semua, 1 akan datang, 2 berlangsung, 3 selesai. */
export async function listSales(c: ShopeeClient, shopId: number, kind = 0, offset = 0, count = 50) {
  const r = await c.get(shopId, `${F}/get_shop_flash_sale_list`, {
    timeslot_type: kind,
    pagination_offset: offset,
    pagination_entry_count: count,
    start_time: now() - 30 * 86400,
    end_time: now() + 60 * 86400,
  });
  return r.response ?? {};
}

export async function getSale(c: ShopeeClient, shopId: number, id: number) {
  return (await c.get(shopId, `${F}/get_shop_flash_sale`, { flash_sale_id: id })).response ?? {};
}

export async function getItems(c: ShopeeClient, shopId: number, id: number) {
  return (await c.get(shopId, `${F}/get_shop_flash_sale_items`, { flash_sale_id: id, offset: 0, limit: 100 })).response ?? {};
}

export async function createSale(c: ShopeeClient, shopId: number, timeslotId: number) {
  return (await c.post(shopId, `${F}/create_shop_flash_sale`, { timeslot_id: timeslotId })).response ?? {};
}

export async function addItems(c: ShopeeClient, shopId: number, id: number, items: FlashItem[]) {
  return (await c.post(shopId, `${F}/add_shop_flash_sale_items`, { flash_sale_id: id, items })).response ?? {};
}

export async function setStatus(c: ShopeeClient, shopId: number, id: number, enable: boolean) {
  return c.post(shopId, `${F}/update_shop_flash_sale`, { flash_sale_id: id, status: enable ? 1 : 2 });
}

export async function deleteSale(c: ShopeeClient, shopId: number, id: number) {
  return c.post(shopId, `${F}/delete_shop_flash_sale`, { flash_sale_id: id });
}

export function validateItems(items: Partial<FlashItem>[]): string[] {
  const errs: string[] = [];
  for (const it of items) {
    if (!it.item_id) errs.push("item tanpa item_id");
    if (!it.models?.length && !it.item_input_promotion_price) {
      errs.push(`item ${it.item_id}: isi item_input_promotion_price atau models`);
    }
    if (!it.purchase_limit) errs.push(`item ${it.item_id}: purchase_limit wajib`);
  }
  return errs;
}
