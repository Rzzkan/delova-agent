/** Definisi tool MCP yang dilihat Claude. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bulk from "./bulk";
import { loadConfig } from "./config";
import * as queue from "./queue";
import * as flash from "./flashSale";
import * as products from "./products";
import * as seo from "./seo";
import { ShopeeClient } from "./shopee";

const shopId = z
  .number()
  .int()
  .optional()
  .describe("ID toko. Boleh dikosongkan bila hanya satu toko terhubung; panggil list_shops untuk melihat daftar.");

const change = z.object({
  item_id: z.number().int(),
  name: z.string().optional().describe("Nama produk baru (20-120 karakter)"),
  description: z.string().optional().describe("Deskripsi baru (maks 3000 karakter)"),
});

const flashItem = z.object({
  item_id: z.number().int(),
  purchase_limit: z.number().int().min(1).describe("Batas beli per pembeli"),
  item_input_promotion_price: z.number().optional().describe("Harga promo (produk tanpa varian)"),
  item_stock: z.number().int().optional(),
  models: z
    .array(z.object({ model_id: z.number().int(), input_promotion_price: z.number(), stock: z.number().int() }))
    .optional()
    .describe("Varian & harga promo masing-masing"),
});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

export function registerTools(server: McpServer, mkClient: () => ShopeeClient = () => new ShopeeClient()) {
  let client: ShopeeClient | null = null;
  const c = () => (client ??= mkClient());

  /** Bungkus handler: resolusi toko + penanganan error seragam. */
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>, shop: () => Promise<number>) => Promise<unknown>,
  ) =>
    server.tool(name, description, shape, (async (args: any) => {
      try {
        return ok(await fn(args, () => c().resolveShop(args.shop_id)));
      } catch (e) {
        return fail(e);
      }
    }) as any);

  tool("list_shops", "Daftar toko Shopee yang sudah terhubung (Wardrobe, Kids, Scarf, dst).", {}, async () =>
    (await c().shops()).map((s) => ({ shop_id: s.shop_id, shop_name: s.shop_name ?? null })),
  );

  tool("shop_info", "Info toko (nama, status, region) untuk mengecek koneksi.", { shop_id: shopId }, async (_a, shop) =>
    c().get(await shop(), "/api/v2/shop/get_shop_info"),
  );

  tool(
    "list_products",
    "Daftar produk toko (id, nama, deskripsi dipotong 300 karakter). Paginasi lewat offset. Gunakan get_products untuk deskripsi lengkap.",
    {
      shop_id: shopId,
      status: z.enum(["NORMAL", "UNLIST", "BANNED", "REVIEWING"]).default("NORMAL"),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(50),
      name_contains: z.string().optional().describe("Filter nama (case-insensitive), diterapkan setelah ambil halaman"),
    },
    async (a, shop) => {
      const sid = await shop();
      const page = await products.listItemIds(c(), sid, a.status, a.offset, a.limit);
      let items = (await products.getBaseInfo(c(), sid, page.ids)).map(products.slim);
      if (a.name_contains) items = items.filter((i) => i.item_name.toLowerCase().includes(a.name_contains!.toLowerCase()));
      return {
        total_in_shop: page.total,
        has_next: page.hasNext,
        next_offset: page.nextOffset,
        items: items.map((i) => ({ ...i, description: i.description.slice(0, 300) })),
      };
    },
  );

  tool(
    "get_products",
    "Detail lengkap produk (nama + deskripsi penuh) berdasarkan item_id, maks 50.",
    { shop_id: shopId, item_ids: z.array(z.number().int()).min(1).max(50) },
    async (a, shop) => (await products.getBaseInfo(c(), await shop(), a.item_ids)).map(products.slim),
  );

  tool(
    "seo_audit",
    "Audit SEO judul & deskripsi satu halaman produk (maks 50). Hanya mengembalikan produk bermasalah. Ulangi dengan next_offset untuk halaman berikutnya.",
    {
      shop_id: shopId,
      status: z.enum(["NORMAL", "UNLIST"]).default("NORMAL"),
      offset: z.number().int().min(0).default(0),
    },
    async (a, shop) => {
      const sid = await shop();
      const page = await products.listItemIds(c(), sid, a.status, a.offset, 50);
      const audits = (await products.getBaseInfo(c(), sid, page.ids)).map((i) => seo.auditItem(products.slim(i)));
      return {
        checked: audits.length,
        flagged: audits.filter((x) => x.issues.length).length,
        has_next: page.hasNext,
        next_offset: page.nextOffset,
        items: audits.filter((x) => x.issues.length),
      };
    },
  );

  tool(
    "preview_product_changes",
    "Validasi & pratinjau perubahan nama/deskripsi tanpa menulis ke Shopee. Selalu panggil ini sebelum apply.",
    { shop_id: shopId, changes: z.array(change).min(1).max(100) },
    async (a, shop) => bulk.previewChanges(c(), await shop(), a.changes),
  );

  tool(
    "apply_product_changes",
    `Terapkan perubahan nama/deskripsi LANGSUNG untuk jumlah kecil (maks ${bulk.MAX_APPLY_PER_CALL} produk per panggilan). Untuk lebih dari itu gunakan queue_enqueue. Default dry_run=true. Set dry_run=false HANYA setelah pengguna menyetujui preview. Backup otomatis; kembalikan lewat rollback_changes dengan backup_id.`,
    { shop_id: shopId, changes: z.array(change).min(1).max(100), dry_run: z.boolean().default(true) },
    async (a, shop) => bulk.applyChanges(c(), await shop(), a.changes, a.dry_run),
  );

  tool(
    "list_backups",
    "Daftar 20 backup terakhir hasil apply_product_changes.",
    {},
    async () => bulk.listBackups(),
  );

  tool(
    "rollback_changes",
    `Pulihkan nama/deskripsi dari backup (maks ${bulk.MAX_APPLY_PER_CALL} produk per panggilan; isi item_ids untuk sebagian).`,
    { backup_id: z.string(), item_ids: z.array(z.number().int()).optional() },
    async (a) => bulk.rollback(c(), a.backup_id, a.item_ids),
  );


  // ------------------------------------------------------------ antrian edit massal

  tool(
    "queue_enqueue",
    `Masukkan perubahan nama/deskripsi ke ANTRIAN untuk jumlah besar (hingga ${queue.MAX_JOB_ITEMS} produk per job; ${queue.MAX_PER_ENQUEUE} per panggilan). ` +
      "Panggilan pertama tanpa job_id membuat job (status draft) dan mengembalikan job_id; panggil lagi dengan job_id yang sama untuk menambah produk. " +
      "Perubahan yang melanggar batas Shopee ditolak dan dilaporkan di 'rejected'. Set start=true pada panggilan terakhir (atau pakai queue_control start) setelah pengguna menyetujui. " +
      "Worker memproses otomatis di latar belakang (~90 produk/menit); pantau dengan queue_status.",
    {
      shop_id: shopId,
      changes: z.array(change).min(1).max(queue.MAX_PER_ENQUEUE),
      job_id: z.string().optional().describe("Isi untuk menambah ke job draft yang sudah ada"),
      label: z.string().optional().describe("Nama job, mis. 'SEO kebaya batch 1'"),
      start: z.boolean().default(false).describe("true = langsung jalankan setelah menambahkan"),
    },
    async (a, shop) => {
      const added = await queue.enqueue({ shopId: await shop(), changes: a.changes, jobId: a.job_id, label: a.label });
      if (!a.start || added.total_in_job === 0) return added;
      const started = await queue.control(added.job_id, "start");
      await queue.scheduleKick(loadConfig());
      return { ...added, ...started };
    },
  );

  tool(
    "queue_control",
    "Kendalikan job antrian. start: mulai job draft. pause/resume: jeda/lanjutkan. cancel: batalkan sisa (yang sudah terubah tetap). " +
      "retry_failed: antrekan ulang produk yang gagal. rollback: buat job baru yang memulihkan nama/deskripsi asli semua produk yang sudah berhasil diubah job ini.",
    { job_id: z.string(), action: z.enum(["start", "pause", "resume", "cancel", "retry_failed", "rollback"]) },
    async (a) => {
      const r = await queue.control(a.job_id, a.action);
      if (["start", "resume", "retry_failed", "rollback"].includes(a.action)) await queue.scheduleKick(loadConfig());
      return r;
    },
  );

  tool(
    "queue_status",
    "Status satu job: jumlah selesai/gagal/menunggu, estimasi menit, alasan jeda, dan contoh produk gagal beserta error-nya.",
    { job_id: z.string() },
    async (a) => queue.status(a.job_id),
  );

  tool("queue_list", "Daftar job antrian terbaru beserta progresnya.", {}, async () => queue.listJobs());

  tool(
    "queue_run",
    "Jalankan worker secara manual selama ~30 detik dan kembalikan hasilnya. Pakai ini hanya bila queue_status menunjukkan job 'queued' " +
      "tetapi tidak maju (worker otomatis tidak berjalan). Panggil berulang sampai more=false.",
    {},
    async () => queue.runSlice(c(), 30_000),
  );

  tool(
    "flash_sale_time_slots",
    "Slot waktu flash sale yang tersedia (timeslot_id dipakai untuk membuat flash sale).",
    { shop_id: shopId, days_ahead: z.number().int().min(1).max(30).default(7) },
    async (a, shop) => flash.timeSlots(c(), await shop(), a.days_ahead),
  );

  tool(
    "flash_sale_list",
    "Daftar flash sale toko. kind: 0 semua, 1 akan datang, 2 berlangsung, 3 selesai.",
    { shop_id: shopId, kind: z.number().int().min(0).max(3).default(0) },
    async (a, shop) => flash.listSales(c(), await shop(), a.kind),
  );

  tool(
    "flash_sale_detail",
    "Detail satu flash sale beserta item di dalamnya.",
    { shop_id: shopId, flash_sale_id: z.number().int() },
    async (a, shop) => {
      const sid = await shop();
      return { sale: await flash.getSale(c(), sid, a.flash_sale_id), items: await flash.getItems(c(), sid, a.flash_sale_id) };
    },
  );

  tool(
    "flash_sale_create",
    "Buat flash sale pada slot waktu lalu tambahkan item. Default dry_run=true; set false hanya setelah pengguna setuju.",
    {
      shop_id: shopId,
      timeslot_id: z.number().int(),
      items: z.array(flashItem).min(1),
      dry_run: z.boolean().default(true),
    },
    async (a, shop) => {
      const errors = flash.validateItems(a.items);
      if (errors.length || a.dry_run) {
        return { dry_run: a.dry_run, errors, timeslot_id: a.timeslot_id, item_count: a.items.length };
      }
      const sid = await shop();
      const sale = await flash.createSale(c(), sid, a.timeslot_id);
      return { flash_sale_id: sale.flash_sale_id, add_items: await flash.addItems(c(), sid, sale.flash_sale_id, a.items) };
    },
  );

  tool(
    "flash_sale_set_status",
    "Aktifkan atau nonaktifkan flash sale.",
    { shop_id: shopId, flash_sale_id: z.number().int(), enable: z.boolean() },
    async (a, shop) => flash.setStatus(c(), await shop(), a.flash_sale_id, a.enable),
  );

  tool(
    "flash_sale_delete",
    "Hapus flash sale. Hanya berjalan bila confirm=true; minta persetujuan pengguna dulu.",
    { shop_id: shopId, flash_sale_id: z.number().int(), confirm: z.boolean().default(false) },
    async (a, shop) => {
      if (!a.confirm) throw new Error("Set confirm=true setelah pengguna menyetujui penghapusan.");
      return flash.deleteSale(c(), await shop(), a.flash_sale_id);
    },
  );
}
