# Delova Agent

Server **MCP** yang berjalan di **VPS (Docker)** supaya **chat Claude** menjadi antarmuka utama untuk mengelola toko Shopee
(Delova Wardrobe, Kids, Scarf) lewat Shopee Open Platform API v2: audit SEO, ubah nama & deskripsi produk massal, dan atur flash sale.
Mulai v0.3 juga mendukung **TikTok Shop** (Partner Center API): audit SEO, edit judul/deskripsi lewat antrian yang sama, dan promosi (diskon, harga tetap, flash sale).

```
Claude (chat) ──MCP/HTTPS──▶ VPS (Next.js, /api/mcp) ──▶ Shopee Open Platform API
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
| Edit kecil (langsung) | `preview_product_changes`, `apply_product_changes`, `list_backups`, `rollback_changes` | Dry-run default, backup otomatis, maks 40 produk/panggilan |
| **Edit massal (antrian)** | `queue_enqueue`, `queue_control`, `queue_status`, `queue_list`, `queue_run` | Hingga 2000 produk/job, diproses otomatis di latar belakang |
| Flash sale | `flash_sale_time_slots`, `_list`, `_detail`, `_create`, `_set_status`, `_delete` | Dry-run default; hapus butuh `confirm` |

## Tool TikTok Shop

Aktif bila `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` diisi (lihat DEPLOY-VPS.md, bagian TikTok Shop). ID produk TikTok selalu **string** (melebihi batas angka JavaScript).

| Area | Tool | Keterangan |
|---|---|---|
| Toko | `tiktok_list_shops` | Satu otorisasi seller bisa membawa beberapa toko |
| Produk | `tiktok_list_products`, `tiktok_get_products` | Paginasi `page_token`; deskripsi berupa HTML |
| SEO | `tiktok_seo_audit`, `tiktok_preview_changes` | Batas judul 25-255, deskripsi maks 10000; preview membandingkan dengan isi toko |
| Edit massal | `queue_enqueue` dengan `platform: "tiktok"` | Antrian, rollback, retry, dashboard sama dengan Shopee (~35 produk/menit) |
| Promosi | `tiktok_promotion_list`, `_detail`, `_create`, `_add_products`, `_remove_products`, `_deactivate` | `DIRECT_DISCOUNT`, `FIXED_PRICE`, `FLASH_SALE`; dry-run default; hapus/nonaktif butuh `confirm` |

> TikTok memeriksa ulang (audit) produk yang judul/deskripsinya diubah, sehingga produk bisa sempat berstatus "Pending" sebelum kembali aktif.
> Path endpoint 202309 untuk produk & promosi ditulis dari dokumentasi Partner Center namun **belum diuji ke toko nyata**; uji dengan 1-2 produk dan `dry_run` dulu.

## Deploy di VPS (Docker)

Untuk VPS yang sudah menjalankan aplikasi lain: lihat **[DEPLOY-VPS.md](DEPLOY-VPS.md)** (compose terisolasi, Redis internal, `deploy/preflight.sh` untuk cek bentrok, snippet Caddy).

## Antrian edit massal

Untuk ratusan produk, Claude memasukkan perubahan ke **antrian** (disimpan di Redis) lalu worker di server memprosesnya
sedikit demi sedikit. Anda tidak perlu menunggu di chat.

```
Claude ──queue_enqueue (≤100/panggilan, berulang)──▶ job DRAFT
Claude ──queue_control start (setelah Anda setuju)──▶ job QUEUED
Worker /api/worker/run: proses ~38 dtk (~75-90 produk) ─▶ memicu dirinya sendiri ─▶ ... ─▶ COMPLETED
Claude ──queue_status──▶ "380/500 selesai, 2 gagal, ±2 menit lagi"
```

**Contoh:** "Tulis ulang judul semua 500 produk kebaya, antrekan, jangan jalan dulu." → Anda cek sampel → "Oke, jalankan." →
"Bagaimana progresnya?" → "Ada yang gagal? Coba ulang." → "Kembalikan semuanya" (rollback).

| Aksi `queue_control` | Fungsi |
|---|---|
| `start` / `resume` | Mulai job draft / lanjutkan job yang dijeda |
| `pause` / `cancel` | Jeda / batalkan sisa (yang sudah terubah tetap) |
| `retry_failed` | Antrekan ulang produk yang gagal |
| `rollback` | Buat job baru yang memulihkan nama/deskripsi asli semua produk yang sudah berubah |

**Perilaku yang sudah dijaga:**
- **Berurutan & aman bersamaan:** satu worker per job (lock), job diproses sesuai urutan dibuat, rate limit dihormati.
- **Nilai asli disimpan sebelum menulis**, sehingga rollback tetap benar walau worker mati di tengah jalan (sudah dites).
- **Error sementara** (server sibuk, timeout, rate limit) dicoba ulang sampai 3 kali; **error permanen** (mis. data ditolak) langsung ditandai gagal dengan alasan, dan produk lain tetap lanjut.
- **Circuit breaker:** 5 gagal berturut-turut atau masalah otorisasi/izin → job **dijeda otomatis** dengan alasan, bukan menghajar API terus. Perbaiki masalahnya, lalu `resume`.
- Produk yang isinya sudah sama dilewati tanpa panggilan API. Produk yang sama dimasukkan dua kali → versi terakhir yang dipakai.
- Pause/cancel dari Claude langsung dihormati worker.

**Penggerak worker (tiga lapis):**
1. **Berantai otomatis** — setiap `start`/`resume` memicu worker; worker memicu dirinya lagi sampai antrian habis.
2. **Penjadwal internal** — tiap 60 detik (`WORKER_INTERVAL_SECONDS`) aplikasi memanggil worker-nya sendiri sebagai jaring pengaman, melanjutkan antrian yang macet.
3. **`queue_run`** — Claude menjalankan worker manual ~30 dtk dari chat bila (1) dan (2) tidak berjalan.

## Dashboard

Buka `https://<domain>/dashboard` dan masuk dengan password dari `DASHBOARD_PASSWORD` (bila kosong: `MCP_SECRET`). Isinya: daftar toko terhubung + perkiraan tanggal berakhir izin akses
(30 hari sejak token diperbarui, diperpanjang otomatis saat toko dipakai), tombol hubungkan/hubungkan ulang toko, serta progres job antrian
secara langsung (berhasil/gagal/menunggu, ETA, alasan jeda, daftar gagal) dengan kontrol mulai, jeda, lanjutkan, batalkan, coba ulang, rollback, dan jalankan worker.
Panel **Flash sale mendatang** menampilkan jadwal flash sale yang akan datang dan sedang berlangsung di tiap toko (Shopee dan TikTok); membuat/mengubah flash sale tetap lewat chat Claude. Panel **Voucher aktif** menampilkan voucher Shopee yang sedang berlaku (kode, diskon, min. belanja, pemakaian, tanggal berakhir); voucher TikTok Shop belum didukung.

## Contoh percakapan

- "Daftar toko Shopee yang terhubung."
- "Audit SEO halaman pertama produk Delova Wardrobe, tampilkan yang bermasalah."
- "Tulis ulang judul 20 produk kebaya itu dengan keyword *kebaya modern wanita*, 90-120 karakter. Preview dulu."
- "Oke, terapkan." → Claude memanggil `apply_product_changes(dry_run=false)`.
- "Kembalikan perubahan tadi." → `rollback_changes`.
- "Buat flash sale slot besok jam 12:00 untuk produk X harga 79rb, limit 2 per pembeli."

Untuk lebih dari beberapa puluh produk Claude memakai antrian (lihat di atas).

## Keamanan

- **`MCP_SECRET` = akses penuh ke toko.** Simpan seperti password. Tanpa `MCP_SECRET` (atau kurang dari 16 karakter) semua endpoint menolak request.
- Connector Claude.ai tidak bisa mengirim header kustom, sehingga kunci ada di URL (`?key=`) dan bisa muncul di log. Ganti `MCP_SECRET` bila bocor (lalu perbarui URL connector).
  Untuk keamanan lebih tinggi, tambahkan OAuth penuh (pengembangan lanjutan).
- Semua operasi tulis default **dry-run**; perubahan yang melanggar batas Shopee dilewati; backup otomatis sebelum menimpa; `SHOPEE_READ_ONLY=true` memblokir semua penulisan.
- Token Shopee disimpan di Redis, bukan di repo. Jangan commit `.env`.

## Catatan penting

- Endpoint & nama field ditulis dari dokumentasi Shopee Open Platform v2 tetapi **belum diuji ke toko nyata**
  (butuh kredensial). Uji dulu dengan `SHOPEE_ENV=sandbox` atau 1-2 produk. Modul flash sale paling perlu diverifikasi.
- Akses API produk/flash sale tergantung izin (permission) app Anda di Shopee Open Platform.
- Kecepatan antrian ±75-90 produk/menit (batas rate limit Shopee); 500 produk ≈ 6 menit.
- Akun utama (*main account*) Shopee belum didukung; otorisasi dilakukan per toko.

## Pengembangan lokal

```bash
npm install
cp .env.example .env.local      # isi; tanpa Redis, data disimpan di .data/ (di-gitignore)
npm run dev                     # http://localhost:3000/api/mcp?key=...
npm test                        # 73 tes: signing (Shopee & TikTok), SEO, auth, bulk, antrian, dashboard, promosi, Redis nyata
npm run typecheck
```

Uji tanpa Claude (MCP Inspector): `npx @modelcontextprotocol/inspector` → Streamable HTTP → URL di atas.

## Struktur

```
src/app/api/[transport]/route.ts   endpoint MCP (/api/mcp), auth rahasia
src/app/dashboard + api/dashboard/*   dashboard (login cookie, data, aksi)
src/lib/dashboard.ts               ringkasan toko/job, status kedaluwarsa
src/app/api/shopee/connect         mulai otorisasi toko
src/app/api/shopee/callback        Redirect URL Shopee, simpan token
src/lib/shopee.ts                  signing HMAC, OAuth, auto-refresh token
src/app/api/worker/run             worker antrian (self-chaining + cron)
src/lib/queue.ts                   antrian: enqueue, kontrol, worker, rollback
src/lib/tools.ts                   definisi tool untuk Claude
src/lib/{products,bulk,seo,flashSale}.ts
src/lib/tiktok*.ts                 klien TikTok Shop, produk, promosi
src/app/api/tiktok/{connect,callback}  otorisasi toko TikTok
src/lib/store.ts                   Upstash Redis (prod) / file (lokal)
tests/
```

Versi Python/CLI sebelumnya (v0.1) masih ada di riwayat git.
