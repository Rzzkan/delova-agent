/** Definisi tool MCP yang dilihat Claude. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bulk from "./bulk";
import { loadConfig, loadTikTokConfig, tiktokConfigured } from "./config";
import * as queue from "./queue";
import * as flash from "./flashSale";
import * as products from "./products";
import * as seo from "./seo";
import { ShopeeClient } from "./shopee";
import { TikTokClient } from "./tiktok";
import * as ttProducts from "./tiktokProducts";
import * as ttPromo from "./tiktokPromo";

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

const ttShopId = z
  .string()
  .optional()
  .describe("ID toko TikTok (string). Boleh dikosongkan bila hanya satu toko terhubung; panggil tiktok_list_shops.");

const queueChange = z.object({
  item_id: z.union([z.number().int(), z.string()]).describe("Shopee: item_id angka. TikTok: product id sebagai STRING"),
  name: z.string().optional().describe("Nama produk baru (Shopee 20-120, TikTok 25-255 karakter)"),
  description: z.string().optional().describe("Deskripsi baru (Shopee maks 3000; TikTok maks 10000, boleh HTML sederhana)"),
});

const promoSku = z.object({
  id: z.string().describe("ID produk (atau ID SKU bila di dalam skus)"),
  activity_price_amount: z.union([z.number(), z.string()]).optional().describe("Harga promo (IDR, bilangan bulat) untuk FIXED_PRICE / FLASH_SALE"),
  discount_percent: z.number().optional().describe("Persen diskon (0-100) untuk DIRECT_DISCOUNT"),
  quantity_limit: z.number().int().optional().describe("Stok promo (wajib untuk FLASH_SALE)"),
  quantity_per_user: z.number().int().optional().describe("Batas beli per pembeli (wajib untuk FLASH_SALE)"),
});
const promoProduct = promoSku.extend({ skus: z.array(promoSku).optional().describe("Isi untuk promo per varian/SKU") });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

export function registerTools(
  server: McpServer,
  mkClient: () => ShopeeClient = () => new ShopeeClient(),
  mkTikTok: () => TikTokClient = () => new TikTokClient(),
) {
  let client: ShopeeClient | null = null;
  const c = () => (client ??= mkClient());
  let ttClient: TikTokClient | null = null;
  const t = () => {
    if (!tiktokConfigured(loadTikTokConfig())) {
      throw new Error("TikTok Shop belum dikonfigurasi di server: isi TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SERVICE_ID di file .env lalu jalankan ulang container.");
    }
    return (ttClient ??= mkTikTok());
  };
  const ttool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>, shop: () => Promise<string>) => Promise<unknown>,
  ) =>
    server.tool(name, description, shape, (async (args: any) => {
      try {
        return ok(await fn(args, () => t().resolveShop(args.shop_id)));
      } catch (e) {
        return fail(e);
      }
    }) as any);

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

  server.tool(
    "queue_enqueue",
    `Masukkan perubahan nama/deskripsi ke ANTRIAN untuk jumlah besar (hingga ${queue.MAX_JOB_ITEMS} produk per job; ${queue.MAX_PER_ENQUEUE} per panggilan). ` +
      "platform: 'shopee' (default) atau 'tiktok' (TikTok Shop; product id harus string). " +
      "Panggilan pertama tanpa job_id membuat job (status draft) dan mengembalikan job_id; panggil lagi dengan job_id yang sama untuk menambah produk. " +
      "Perubahan yang melanggar batas marketplace ditolak dan dilaporkan di 'rejected'. Set start=true pada panggilan terakhir (atau pakai queue_control start) setelah pengguna menyetujui. " +
      "Worker memproses otomatis di latar belakang (Shopee ~90 produk/menit, TikTok ~35); pantau dengan queue_status.",
    {
      platform: z.enum(["shopee", "tiktok"]).default("shopee"),
      shop_id: z.union([z.number().int(), z.string()]).optional().describe("ID toko; boleh kosong bila hanya satu toko terhubung di platform itu"),
      changes: z.array(queueChange).min(1).max(queue.MAX_PER_ENQUEUE),
      job_id: z.string().optional().describe("Isi untuk menambah ke job draft yang sudah ada"),
      label: z.string().optional().describe("Nama job, mis. 'SEO kebaya batch 1'"),
      start: z.boolean().default(false).describe("true = langsung jalankan setelah menambahkan"),
    },
    (async (a: any) => {
      try {
        const shop = a.platform === "tiktok" ? await t().resolveShop(a.shop_id) : await c().resolveShop(a.shop_id === undefined ? undefined : Number(a.shop_id));
        const added = await queue.enqueue({ shopId: shop, platform: a.platform, changes: a.changes, jobId: a.job_id, label: a.label });
        if (!a.start || added.total_in_job === 0) return ok(added);
        const started = await queue.control(added.job_id, "start");
        await queue.scheduleKick(loadConfig());
        return ok({ ...added, ...started });
      } catch (e) {
        return fail(e);
      }
    }) as any,
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
    async () => queue.runSlice(c(), 30_000, tiktokConfigured(loadTikTokConfig()) ? t() : undefined),
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

  // ------------------------------------------------------------ TikTok Shop

  ttool("tiktok_list_shops", "Daftar toko TikTok Shop yang sudah terhubung (id, nama, region).", {}, async () =>
    (await t().shops()).map((s) => ({ shop_id: s.shop_id, shop_name: s.shop_name ?? null, region: s.region ?? null })),
  );

  ttool(
    "tiktok_list_products",
    "Daftar produk TikTok Shop (id string, judul, status). Paginasi lewat page_token. Gunakan tiktok_get_products untuk deskripsi.",
    {
      shop_id: ttShopId,
      status: z.enum(["ALL", "DRAFT", "PENDING", "FAILED", "ACTIVATE", "SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED", "FREEZE", "DELETED"]).default("ACTIVATE"),
      page_token: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      name_contains: z.string().optional().describe("Filter judul (case-insensitive), diterapkan setelah ambil halaman"),
    },
    async (a, shop) => {
      const r = await ttProducts.searchProducts(t(), await shop(), { status: a.status === "ALL" ? undefined : a.status, pageToken: a.page_token, pageSize: a.limit });
      const items = a.name_contains ? r.items.filter((i: any) => i.item_name.toLowerCase().includes(a.name_contains!.toLowerCase())) : r.items;
      return { total_in_shop: r.total, next_page_token: r.nextPageToken ?? null, items };
    },
  );

  ttool(
    "tiktok_get_products",
    "Detail produk TikTok Shop (judul + deskripsi HTML penuh) berdasarkan product id, maks 10 per panggilan.",
    { shop_id: ttShopId, item_ids: z.array(z.string()).min(1).max(10) },
    async (a, shop) => ttProducts.getMany(t(), await shop(), a.item_ids),
  );

  ttool(
    "tiktok_seo_audit",
    "Audit SEO judul & deskripsi satu halaman produk TikTok Shop (maks 20; tiap produk 1 panggilan detail). Hanya mengembalikan yang bermasalah. Lanjutkan dengan next_page_token.",
    {
      shop_id: ttShopId,
      status: z.enum(["ACTIVATE", "SELLER_DEACTIVATED"]).default("ACTIVATE"),
      page_token: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(20),
    },
    async (a, shop) => {
      const sid = await shop();
      const page = await ttProducts.searchProducts(t(), sid, { status: a.status, pageToken: a.page_token, pageSize: a.limit });
      const rows = await ttProducts.getMany(t(), sid, page.items.map((i: any) => i.item_id));
      const audits = rows.map((r) => seo.auditItem({ item_id: r.item_id, item_name: r.item_name, description: ttProducts.strip(r.description) }, seo.TIKTOK_LIMITS));
      return {
        checked: audits.length,
        flagged: audits.filter((x) => x.issues.length).length,
        next_page_token: page.nextPageToken ?? null,
        items: audits.filter((x) => x.issues.length),
      };
    },
  );

  ttool(
    "tiktok_preview_changes",
    "Validasi & pratinjau perubahan judul/deskripsi TikTok Shop (membandingkan dengan isi toko saat ini) tanpa menulis. Maks 20 produk. Untuk menerapkan, pakai queue_enqueue dengan platform='tiktok'.",
    { shop_id: ttShopId, changes: z.array(queueChange).min(1).max(20) },
    async (a, shop) => {
      const sid = await shop();
      const cur = new Map((await ttProducts.getMany(t(), sid, a.changes.map((x) => String(x.item_id)))).map((r) => [r.item_id, r]));
      return a.changes.map((ch) => {
        const id = String(ch.item_id);
        const now = cur.get(id);
        const errors = seo.blockingErrors(ch.name, ch.description, seo.TIKTOK_LIMITS);
        if (!now) errors.push("produk tidak ditemukan di toko");
        return {
          item_id: id,
          errors,
          name: ch.name === undefined ? undefined : { before: now?.item_name, after: ch.name, seo_notes: seo.validateTitle(ch.name, seo.TIKTOK_LIMITS) },
          description_changed: ch.description !== undefined && ch.description !== now?.description,
          will_apply: errors.length === 0 && (ch.name !== now?.item_name || (ch.description !== undefined && ch.description !== now?.description)),
        };
      });
    },
  );

  const when = (iso: string, label: string) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`${label}: format waktu tidak valid. Contoh: 2026-11-11T12:00:00+07:00`);
    return Math.floor(ms / 1000);
  };

  ttool(
    "tiktok_promotion_list",
    "Daftar aktivitas promosi TikTok Shop (diskon, harga tetap, flash sale).",
    {
      shop_id: ttShopId,
      status: z.enum(["NOT_START", "ONGOING", "EXPIRED", "DEACTIVATED"]).optional(),
      activity_type: z.enum(ttPromo.ACTIVITY_TYPES as [string, ...string[]]).optional(),
      page_token: z.string().optional(),
    },
    async (a, shop) => ttPromo.listActivities(t(), await shop(), { status: a.status, type: a.activity_type as ttPromo.ActivityType | undefined, pageToken: a.page_token }),
  );

  ttool(
    "tiktok_promotion_detail",
    "Detail satu aktivitas promosi beserta produknya.",
    { shop_id: ttShopId, activity_id: z.string() },
    async (a, shop) => ttPromo.getActivity(t(), await shop(), a.activity_id),
  );

  ttool(
    "tiktok_promotion_create",
    "Buat promosi TikTok Shop lalu tambahkan produk. activity_type: DIRECT_DISCOUNT (isi discount_percent), FIXED_PRICE (activity_price_amount), FLASH_SALE (harga + quantity_limit + quantity_per_user). " +
      "Waktu dalam ISO dengan zona (mis. 2026-11-11T12:00:00+07:00). Default dry_run=true; set false hanya setelah pengguna menyetujui. Maks 50 produk.",
    {
      shop_id: ttShopId,
      title: z.string().describe("Judul promosi (maks 50 karakter)"),
      activity_type: z.enum(ttPromo.ACTIVITY_TYPES as [string, ...string[]]),
      begin_time: z.string(),
      end_time: z.string(),
      products: z.array(promoProduct).min(1).max(ttPromo.MAX_PROMO_PRODUCTS),
      dry_run: z.boolean().default(true),
    },
    async (a, shop) => {
      const input: ttPromo.PromoInput = {
        title: a.title,
        activity_type: a.activity_type as ttPromo.ActivityType,
        begin_time: when(a.begin_time, "begin_time"),
        end_time: when(a.end_time, "end_time"),
        products: a.products,
      };
      const errors = ttPromo.validatePromo(input);
      if (errors.length || a.dry_run) return { dry_run: a.dry_run, errors, product_count: a.products.length, request_body: ttPromo.productsBody(a.products) };
      const sid = await shop();
      const created = await ttPromo.createActivity(t(), sid, input);
      if (!created.activity_id) throw new Error("TikTok tidak mengembalikan activity_id: " + JSON.stringify(created.raw));
      try {
        return { activity_id: created.activity_id, add_products: await ttPromo.addProducts(t(), sid, created.activity_id, a.products) };
      } catch (e) {
        throw new Error(`Promosi ${created.activity_id} sudah dibuat tetapi penambahan produk gagal (${e instanceof Error ? e.message : e}). Coba tiktok_promotion_add_products, atau nonaktifkan dengan tiktok_promotion_deactivate.`);
      }
    },
  );

  ttool(
    "tiktok_promotion_add_products",
    "Tambah/perbarui produk pada promosi yang sudah ada (maks 50). Default dry_run=true.",
    { shop_id: ttShopId, activity_id: z.string(), activity_type: z.enum(ttPromo.ACTIVITY_TYPES as [string, ...string[]]), products: z.array(promoProduct).min(1).max(ttPromo.MAX_PROMO_PRODUCTS), dry_run: z.boolean().default(true) },
    async (a, shop) => {
      const errors = ttPromo.validatePromo({ title: "x", activity_type: a.activity_type as ttPromo.ActivityType, begin_time: Number.MAX_SAFE_INTEGER - 1, end_time: Number.MAX_SAFE_INTEGER, products: a.products });
      if (errors.length || a.dry_run) return { dry_run: a.dry_run, errors, request_body: ttPromo.productsBody(a.products) };
      return ttPromo.addProducts(t(), await shop(), a.activity_id, a.products);
    },
  );

  ttool(
    "tiktok_promotion_remove_products",
    "Keluarkan produk dari promosi. Hanya berjalan bila confirm=true.",
    { shop_id: ttShopId, activity_id: z.string(), product_ids: z.array(z.string()).min(1), confirm: z.boolean().default(false) },
    async (a, shop) => {
      if (!a.confirm) throw new Error("Set confirm=true setelah pengguna menyetujui.");
      return ttPromo.removeProducts(t(), await shop(), a.activity_id, a.product_ids);
    },
  );

  ttool(
    "tiktok_promotion_deactivate",
    "Nonaktifkan promosi. Hanya berjalan bila confirm=true; minta persetujuan pengguna dulu.",
    { shop_id: ttShopId, activity_id: z.string(), confirm: z.boolean().default(false) },
    async (a, shop) => {
      if (!a.confirm) throw new Error("Set confirm=true setelah pengguna menyetujui.");
      return ttPromo.deactivate(t(), await shop(), a.activity_id);
    },
  );
}
