/** Bulk edit aman: validasi -> preview (dry-run) -> backup -> apply -> rollback. */
import { randomBytes } from "node:crypto";
import * as seo from "./seo";
import * as products from "./products";
import { ShopeeClient, ShopeeError } from "./shopee";
import { KEYS, getStore } from "./store";

export interface Change {
  item_id: number;
  name?: string;
  description?: string;
}

/** Batas per panggilan agar muat dalam durasi fungsi serverless (~0,3 dtk per item). */
export const MAX_APPLY_PER_CALL = 40;

export async function previewChanges(c: ShopeeClient, shopId: number, changes: Change[]) {
  const current = new Map(
    (await products.getBaseInfo(c, shopId, changes.map((x) => x.item_id))).map((i) => [i.item_id as number, products.slim(i)]),
  );
  let valid = 0;
  let invalid = 0;
  const rows = changes.map((ch) => {
    const cur = current.get(ch.item_id);
    if (!cur) {
      invalid++;
      return { item_id: ch.item_id, status: "tidak ditemukan" };
    }
    const errors = seo.blockingErrors(ch.name, ch.description);
    const warnings = ch.name !== undefined ? seo.validateTitle(ch.name) : [];
    errors.length ? invalid++ : valid++;
    return {
      item_id: ch.item_id,
      status: errors.length ? "error" : "ok",
      errors,
      warnings,
      ...(ch.name !== undefined && { name_before: cur.item_name, name_after: ch.name }),
      ...(ch.description !== undefined && {
        desc_before_len: cur.description.length,
        desc_after_len: ch.description.length,
      }),
    };
  });
  return { total: changes.length, valid, invalid, rows };
}

export async function applyChanges(c: ShopeeClient, shopId: number, changes: Change[], dryRun = true) {
  const report: Record<string, any> = await previewChanges(c, shopId, changes);
  if (dryRun) return { ...report, dry_run: true };
  if (changes.length > MAX_APPLY_PER_CALL) {
    throw new Error(`Maks ${MAX_APPLY_PER_CALL} produk per panggilan apply; bagi jadi beberapa batch.`);
  }

  const originals = (await products.getBaseInfo(c, shopId, changes.map((x) => x.item_id))).map(products.slim);
  const byId = new Map(originals.map((o) => [o.item_id, o]));
  const backupId = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  await getStore().hset(KEYS.backups, backupId, {
    id: backupId,
    shop_id: shopId,
    created_at: new Date().toISOString(),
    items: originals,
  });

  const okIds = new Set(report.rows.filter((r: any) => r.status === "ok").map((r: any) => r.item_id));
  const results: { item_id: number; result: string }[] = [];
  for (const ch of changes) {
    if (!okIds.has(ch.item_id)) {
      results.push({ item_id: ch.item_id, result: "dilewati (tidak valid)" });
      continue;
    }
    try {
      await products.updateItem(c, shopId, ch.item_id, {
        name: ch.name,
        description: ch.description,
        descriptionType: byId.get(ch.item_id)!.description_type,
      });
      results.push({ item_id: ch.item_id, result: "berhasil" });
    } catch (e) {
      results.push({ item_id: ch.item_id, result: `gagal: ${e instanceof ShopeeError ? `${e.code} ${e.detail}` : String(e)}` });
    }
  }
  return {
    ...report,
    dry_run: false,
    backup_id: backupId,
    results,
    success: results.filter((r) => r.result === "berhasil").length,
  };
}

export async function rollback(c: ShopeeClient, backupId: string, itemIds?: number[]) {
  const b = await getStore().hget<{ shop_id: number; items: products.SlimItem[] }>(KEYS.backups, backupId);
  if (!b) throw new Error(`backup_id ${backupId} tidak ditemukan`);
  const items = (itemIds ? b.items.filter((i) => itemIds.includes(i.item_id)) : b.items).slice(0, MAX_APPLY_PER_CALL);
  const results: { item_id: number; result: string }[] = [];
  for (const o of items) {
    try {
      await products.updateItem(c, b.shop_id, o.item_id, {
        name: o.item_name,
        description: o.description,
        descriptionType: o.description_type,
      });
      results.push({ item_id: o.item_id, result: "dipulihkan" });
    } catch (e) {
      results.push({ item_id: o.item_id, result: `gagal: ${e instanceof ShopeeError ? `${e.code} ${e.detail}` : String(e)}` });
    }
  }
  return { backup_id: backupId, restored: results.filter((r) => r.result === "dipulihkan").length, results };
}

export async function listBackups() {
  const all = await getStore().hgetall<{ id: string; shop_id: number; created_at: string; items: unknown[] }>(KEYS.backups);
  return Object.values(all)
    .map((b) => ({ backup_id: b.id, shop_id: b.shop_id, created_at: b.created_at, item_count: b.items.length }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
}
