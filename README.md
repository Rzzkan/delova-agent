# Shopee Agent

Server MCP + CLI agar **Claude** bisa mengelola toko Shopee lewat Shopee Open Platform API v2:
audit SEO, ubah nama & deskripsi produk secara massal, dan atur flash sale.

Dibuat untuk toko Delova Wardrobe / Delova Kids / Delova Scarf (satu shop per otorisasi).

## Fitur

| Area | Tool MCP | Keterangan |
|---|---|---|
| Toko | `shop_info` | Cek koneksi |
| Produk | `list_products`, `get_products` | Ambil id, nama, deskripsi |
| SEO | `seo_audit` | Cek judul 20-120 karakter, huruf kapital, emoji, spam, kata berulang, deskripsi ≤3000 |
| Bulk edit | `preview_product_changes`, `apply_product_changes`, `rollback_changes` | Dry-run default, backup otomatis, bisa rollback |
| Flash sale | `flash_sale_time_slots`, `flash_sale_list`, `flash_sale_detail`, `flash_sale_create`, `flash_sale_set_status`, `flash_sale_delete` | Dry-run default, hapus butuh `confirm` |

Pembagian peran: **Claude yang menulis ulang judul/deskripsi** (keyword Shopee, gaya brand),
aplikasi ini yang memvalidasi, mem-backup, dan mengirimkannya ke Shopee dengan aman.

## Setup

1. Daftar & buat app di [Shopee Open Platform](https://open.shopee.com), catat **Partner ID** dan **Partner Key**.
   Daftarkan Redirect URL (mis. `https://example.com/callback`).
2. Install:
   ```bash
   cd "Shopee Agent"
   python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   cp .env.example .env     # lalu isi PARTNER_ID, PARTNER_KEY, REDIRECT_URL
   ```
3. Login toko (sekali per toko, token berlaku 30 hari dan diperbarui otomatis):
   ```bash
   shopee-agent auth-url                 # buka URL di browser, login sebagai seller, izinkan
   # Browser redirect ke: https://example.com/callback?code=XXXX&shop_id=YYYY
   shopee-agent auth-exchange XXXX --shop-id YYYY
   shopee-agent shop-info                # cek koneksi
   ```
   Token disimpan di `data/tokens.json` (di-gitignore).

## Pakai dengan Claude

**Claude Code** (otomatis membaca `.mcp.json` di folder ini):
```bash
cd "Shopee Agent" && claude
```

**Claude Desktop**: tambahkan ke `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "shopee-agent": {
      "command": "/PATH/ke/Shopee Agent/.venv/bin/python",
      "args": ["-m", "shopee_agent.mcp_server"],
      "cwd": "/PATH/ke/Shopee Agent"
    }
  }
}
```

Contoh perintah ke Claude:
- "Audit SEO semua produk, tampilkan yang bermasalah."
- "Tulis ulang judul 30 produk kebaya ini dengan keyword *kebaya modern wanita*, panjang 90-120 karakter, tampilkan preview dulu."
- "Oke, terapkan." (Claude baru memanggil `apply_product_changes(dry_run=False)`)
- "Buat flash sale untuk slot besok jam 12:00, item X harga 79rb, limit 2 per pembeli."
- "Kembalikan perubahan tadi" (rollback dari backup).

## CLI (tanpa Claude)

```bash
shopee-agent list --limit 20
shopee-agent audit
shopee-agent export produk.csv        # edit di Excel/Sheets: kolom item_id, item_name, description
shopee-agent import produk.csv        # dry-run
shopee-agent import produk.csv --apply
shopee-agent rollback data/backups/backup_YYYYMMDD_HHMMSS.json
shopee-agent flash-slots --days 7
```

## Keamanan

- `.env` dan `data/` (token, backup) **tidak pernah** di-commit.
- Semua operasi tulis default **dry-run**. Set `SHOPEE_READ_ONLY=true` untuk memblokir semua penulisan.
- Perubahan yang melanggar batas Shopee (nama 20-120, deskripsi >3000) otomatis dilewati.
- Rate limit dihormati (jeda 250 ms antar panggilan).

## Catatan penting

- Endpoint & nama field ditulis dari dokumentasi Shopee Open Platform v2 tetapi **belum diuji ke toko nyata**
  (butuh kredensial). Uji dulu di `SHOPEE_ENV=sandbox` atau dengan 1-2 produk; cek
  [dokumentasi](https://open.shopee.com/documents) bila ada error. Modul flash sale paling perlu diverifikasi.
- Perubahan nama produk yang sering dapat memengaruhi ranking; ubah bertahap dan pantau.
- Akses API produk/flash sale tergantung izin (permission) app Anda di Shopee Open Platform.

## Pengujian

```bash
pytest
```

## Struktur

```
shopee_agent/
  client.py      signing HMAC, OAuth, auto-refresh token
  products.py    list / detail / update produk
  bulk.py        preview, apply, backup, rollback, CSV
  seo.py         aturan SEO judul & deskripsi
  flash_sale.py  shop flash sale
  mcp_server.py  tool untuk Claude
  cli.py         perintah terminal
tests/
```
