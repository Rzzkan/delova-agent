# Shopee Agent

Server **MCP** yang berjalan di **Vercel** supaya **chat Claude** menjadi antarmuka utama untuk mengelola toko Shopee
(Delova Wardrobe, Kids, Scarf) lewat Shopee Open Platform API v2: audit SEO, ubah nama & deskripsi produk massal, dan atur flash sale.

```
Claude (chat) ──MCP/HTTPS──▶ Vercel (Next.js, /api/mcp) ──▶ Shopee Open Platform API
                                      │
                                      └── Upstash Redis (token toko + backup)
```

Pembagian peran: **Claude yang menulis ulang judul/deskripsi** (keyword, gaya brand). Aplikasi ini memvalidasi aturan Shopee,
membuat backup, dan mengirimkannya dengan aman.

## Tool yang tersedia di Claude

| Area | Tool | Keterangan |
|---|---|---|
| Toko | `list_shops`, `shop_info` | Multi-toko; sebut `shop_id` bila lebih dari satu |
| Produk | `list_products`, `get_products` | Paginasi `offset`; deskripsi dipotong di list |
| SEO | `seo_audit` | Judul 20-120 karakter, kapital, emoji, spam, kata berulang, deskripsi ≤3000 |
| Edit massal | `preview_product_changes`, `apply_product_changes`, `list_backups`, `rollback_changes` | Dry-run default, backup otomatis, maks 40 produk/panggilan |
| Flash sale | `flash_sale_time_slots`, `_list`, `_detail`, `_create`, `_set_status`, `_delete` | Dry-run default; hapus butuh `confirm` |

## Deploy ke Vercel

### 1. Push repo ke GitHub, lalu import di Vercel
`vercel.com/new` → pilih repo `shopee-agent`. Framework terdeteksi otomatis (Next.js).

### 2. Pasang Redis
Di project Vercel: **Storage → Marketplace → Upstash Redis → Create**, hubungkan ke project.
Variabel `KV_REST_API_URL` / `KV_REST_API_TOKEN` terisi otomatis. (Vercel tidak punya disk tetap, jadi Redis wajib.)

### 3. Isi Environment Variables
| Variabel | Isi |
|---|---|
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | Dari Shopee Open Platform Console |
| `MCP_SECRET` | Acak ≥16 karakter, mis. `openssl rand -hex 24`. **Kunci akses ke seluruh toko Anda.** |
| `SHOPEE_ENV` | `production` (atau `sandbox` untuk uji) |
| `SHOPEE_READ_ONLY` | `true` untuk audit saja (opsional) |

Lalu **Redeploy**. Catat domain produksinya, mis. `https://shopee-agent.vercel.app`.

### 4. Daftarkan Redirect URL di Shopee
Di app Shopee Open Platform, set Redirect URL ke:
`https://<domain-anda>/api/shopee/callback`

### 5. Hubungkan tiap toko (sekali per toko)
Buka di browser:
`https://<domain-anda>/api/shopee/connect?key=<MCP_SECRET>`
Login sebagai seller toko tersebut → **Confirm Authorization** → muncul "Toko terhubung".
Ulangi untuk Kids dan Scarf (login ke akun toko masing-masing). Token berlaku 30 hari dan diperbarui otomatis.

### 6. Tambahkan ke Claude
- **Claude.ai / aplikasi desktop**: Settings → Connectors → *Add custom connector* →
  URL: `https://<domain-anda>/api/mcp?key=<MCP_SECRET>`
- **Claude Code**:
  ```bash
  claude mcp add --transport http shopee-agent https://<domain-anda>/api/mcp \
    --header "Authorization: Bearer <MCP_SECRET>"
  ```

## Contoh percakapan

- "Daftar toko Shopee yang terhubung."
- "Audit SEO halaman pertama produk Delova Wardrobe, tampilkan yang bermasalah."
- "Tulis ulang judul 20 produk kebaya itu dengan keyword *kebaya modern wanita*, 90-120 karakter. Preview dulu."
- "Oke, terapkan." → Claude memanggil `apply_product_changes(dry_run=false)`.
- "Kembalikan perubahan tadi." → `rollback_changes`.
- "Buat flash sale slot besok jam 12:00 untuk produk X harga 79rb, limit 2 per pembeli."

Untuk ratusan produk Claude akan memproses per batch (≤40 produk per panggilan karena batas waktu fungsi Vercel).

## Keamanan

- **`MCP_SECRET` = akses penuh ke toko.** Simpan seperti password. Tanpa `MCP_SECRET` (atau kurang dari 16 karakter) semua endpoint menolak request.
- Connector Claude.ai tidak bisa mengirim header kustom, sehingga kunci ada di URL (`?key=`) dan bisa muncul di log. Ganti `MCP_SECRET` bila bocor (lalu perbarui URL connector).
  Untuk keamanan lebih tinggi, tambahkan OAuth penuh (pengembangan lanjutan).
- Semua operasi tulis default **dry-run**; perubahan yang melanggar batas Shopee dilewati; backup otomatis sebelum menimpa; `SHOPEE_READ_ONLY=true` memblokir semua penulisan.
- Token Shopee disimpan di Redis, bukan di repo. Jangan commit `.env`.
- Aktifkan **Vercel Deployment Protection** hanya untuk preview; jangan untuk produksi, karena Claude perlu mengakses `/api/mcp`.

## Catatan penting

- Endpoint & nama field ditulis dari dokumentasi Shopee Open Platform v2 tetapi **belum diuji ke toko nyata**
  (butuh kredensial). Uji dulu dengan `SHOPEE_ENV=sandbox` atau 1-2 produk. Modul flash sale paling perlu diverifikasi.
- Akses API produk/flash sale tergantung izin (permission) app Anda di Shopee Open Platform.
- Plan Hobby Vercel membatasi fungsi hingga 60 dtk; cukup untuk batch 40 produk.
- Akun utama (*main account*) Shopee belum didukung; otorisasi dilakukan per toko.

## Pengembangan lokal

```bash
npm install
cp .env.example .env.local      # isi; tanpa Redis, data disimpan di .data/ (di-gitignore)
npm run dev                     # http://localhost:3000/api/mcp?key=...
npm test                        # 15 tes: signing, SEO, auth, alur bulk/backup/rollback/refresh
npm run typecheck
```

Uji tanpa Claude (MCP Inspector): `npx @modelcontextprotocol/inspector` → Streamable HTTP → URL di atas.

## Struktur

```
src/app/api/[transport]/route.ts   endpoint MCP (/api/mcp), auth rahasia
src/app/api/shopee/connect         mulai otorisasi toko
src/app/api/shopee/callback        Redirect URL Shopee, simpan token
src/lib/shopee.ts                  signing HMAC, OAuth, auto-refresh token
src/lib/tools.ts                   definisi tool untuk Claude
src/lib/{products,bulk,seo,flashSale}.ts
src/lib/store.ts                   Upstash Redis (prod) / file (lokal)
tests/
```

Versi Python/CLI sebelumnya (v0.1) masih ada di riwayat git.
