/**
 * Usulan perubahan judul/deskripsi: Claude mengusulkan (tool propose_changes), manusia menyetujui di
 * dashboard. Persetujuan baru menulis ke marketplace, lewat productAdmin.editProduct (validasi + backup).
 */
import { randomBytes } from "node:crypto";
import * as pa from "./productAdmin";
import { BRANDS, Brand, Score, brandOf, combined, scoreDescription, scoreTitle } from "./scoring";
import { strip } from "./tiktokProducts";
import { KEYS, getStore } from "./store";

export type Status = "pending" | "applied" | "rejected" | "failed" | "stale" | "reverted";
export interface ScoreSet {
  title: Score;
  desc: Score;
  total: number;
}
export interface Proposal {
  id: string;
  platform: pa.Platform;
  shop_id: string;
  shop_name: string | null;
  brand: Brand;
  product_id: string;
  current_name: string;
  current_description: string;
  new_name?: string;
  new_description?: string;
  note?: string;
  status: Status;
  created_at: string;
  decided_at?: string;
  error?: string;
  backup_id?: string;
  before: ScoreSet;
  after: ScoreSet;
}

export const MAX_APPROVE_PER_CALL = 40;
type Clients = Parameters<typeof pa.listProducts>[0];
const plain = (platform: pa.Platform, d: string) => (platform === "tiktok" ? strip(d) : d);

export function scoreSet(platform: pa.Platform, name: string, description: string): ScoreSet {
  const lim = pa.limitsFor(platform);
  const title = scoreTitle(name, lim);
  const desc = scoreDescription(plain(platform, description), lim);
  return { title, desc, total: combined(title, desc) };
}

const all = async () => Object.values(await getStore().hgetall<Proposal>(KEYS.proposals));
const save = (p: Proposal) => getStore().hset(KEYS.proposals, p.id, p);
const now = () => new Date().toISOString();

export interface Incoming {
  item_id: string | number;
  name?: string;
  description?: string;
  note?: string;
}

/** Buat usulan. Yang tidak valid / tidak berubah / tidak ditemukan dikembalikan di `skipped` dengan alasan. */
export async function createProposals(clients: Clients, platform: pa.Platform, shopId: string, shopName: string | null, changes: Incoming[]) {
  const created: Proposal[] = [];
  const skipped: { item_id: string; reason: string }[] = [];
  const existing = await all();
  for (const ch of changes) {
    const id = String(ch.item_id);
    try {
      if (ch.name === undefined && ch.description === undefined) throw new Error("tidak ada perubahan diusulkan");
      const cur = await pa.getDetail(clients, platform, shopId, id);
      const name = ch.name !== undefined && ch.name.trim() !== cur.name.trim() ? ch.name.trim() : undefined;
      const description = ch.description !== undefined && ch.description !== cur.description ? ch.description : undefined;
      if (name === undefined && description === undefined) throw new Error("sama dengan data sekarang");
      const errors = pa.checkEdit(platform, { name, description }).errors;
      if (errors.length) throw new Error(errors.join("; "));
      // usulan pending lama untuk produk yang sama digantikan
      for (const old of existing.filter((e) => e.status === "pending" && e.platform === platform && e.shop_id === shopId && e.product_id === id)) {
        await save({ ...old, status: "rejected", decided_at: now(), error: "digantikan usulan baru" });
      }
      const p: Proposal = {
        id: `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`,
        platform, shop_id: shopId, shop_name: shopName, brand: brandOf(shopName), product_id: id,
        current_name: cur.name, current_description: cur.description,
        ...(name !== undefined && { new_name: name }), ...(description !== undefined && { new_description: description }),
        ...(ch.note && { note: ch.note.slice(0, 300) }),
        status: "pending", created_at: now(),
        before: scoreSet(platform, cur.name, cur.description),
        after: scoreSet(platform, name ?? cur.name, description ?? cur.description),
      };
      await save(p);
      created.push(p);
    } catch (e) {
      skipped.push({ item_id: id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { created, skipped };
}

export async function listProposals(o: { status?: Status | "all"; platform?: pa.Platform } = {}) {
  const status = o.status ?? "pending";
  return (await all())
    .filter((p) => (status === "all" || p.status === status) && (!o.platform || p.platform === o.platform))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function groupByBrand(list: Proposal[]) {
  return BRANDS.map((brand) => ({ brand, items: list.filter((p) => p.brand === brand) })).filter((g) => g.items.length);
}

async function load(ids: string[]) {
  const out: Proposal[] = [];
  for (const id of ids) {
    const p = await getStore().hget<Proposal>(KEYS.proposals, id);
    if (p) out.push(p);
  }
  return out;
}

export async function reject(ids: string[]) {
  let n = 0;
  for (const p of await load(ids)) {
    if (p.status !== "pending") continue;
    await save({ ...p, status: "rejected", decided_at: now() });
    n++;
  }
  return { rejected: n };
}

/** Setujui + terapkan. Data berubah sejak usulan dibuat -> `stale` (tidak ditulis). */
export async function approve(clients: Clients, ids: string[]) {
  if (ids.length > MAX_APPROVE_PER_CALL) throw new Error(`Maks ${MAX_APPROVE_PER_CALL} usulan per persetujuan; bagi jadi beberapa batch.`);
  const results: { id: string; status: Status; error?: string }[] = [];
  for (const p of await load(ids)) {
    if (p.status !== "pending") { results.push({ id: p.id, status: p.status, error: "bukan usulan pending" }); continue; }
    try {
      const cur = await pa.getDetail(clients, p.platform, p.shop_id, p.product_id);
      if (cur.name !== p.current_name || cur.description !== p.current_description) {
        await save({ ...p, status: "stale", decided_at: now(), error: "Produk berubah sejak usulan dibuat; minta Claude mengusulkan ulang." });
        results.push({ id: p.id, status: "stale", error: "produk berubah sejak usulan" });
        continue;
      }
      const r = await pa.editProduct(clients, p.platform, p.shop_id, p.product_id, { name: p.new_name, description: p.new_description });
      await save({ ...p, status: "applied", decided_at: now(), backup_id: r.backup_id });
      results.push({ id: p.id, status: "applied" });
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await save({ ...p, status: "failed", decided_at: now(), error });
      results.push({ id: p.id, status: "failed", error });
    }
  }
  return { applied: results.filter((r) => r.status === "applied").length, results };
}

/** Batalkan usulan yang sudah diterapkan: kembalikan nama/deskripsi dari backup. */
export async function revert(clients: Clients, ids: string[]) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const p of await load(ids.slice(0, MAX_APPROVE_PER_CALL))) {
    if (p.status !== "applied" || !p.backup_id) { results.push({ id: p.id, ok: false, error: "tidak bisa dibatalkan" }); continue; }
    try {
      await pa.restore(clients, p.backup_id);
      await save({ ...p, status: "reverted", decided_at: now() });
      results.push({ id: p.id, ok: true });
    } catch (e) {
      results.push({ id: p.id, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  }
  return { reverted: results.filter((r) => r.ok).length, results };
}
