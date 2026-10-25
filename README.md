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
| Edit kecil (langsung) | `preview_product_changes`, `apply_product_changes`, `list_backups`, `rollback_changes` | Dry-run default, backup otomatis, maks 40 produk/panggilan |
| **Edit massal (antrian)** | `queue_enqueue`, `queue_control`, `queue_status`, `queue_list`, `queue_run` | Hingga 2000 produk/job, diproses otomatis di latar belakang |
| Flash sale | `flash_sale_time_slots`, `_list`, `_detail`, `_create`, `_set_status`, `_delete` | Dry-run default; hapus butuh `confirm` |

## Deploy ke Vercel

Panduan langkah demi langkah (GitHub → Vercel → Redis → Shopee → verifikasi → connector Claude → uji bertahap → troubleshooting) ada di **[DEPLOY.md](DEPLOY.md)**.

Ringkasnya: push repo ke GitHub, import ke Vercel, pasang Upstash Redis, isi env (`MCP_SECRET`, `CRON_SECRET`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV`),
set Redirect URL Shopee ke `https://<domain>/api/shopee/callback`, hubungkan tiap toko lewat `/api/shopee/connect?key=<MCP_SECRET>`, lalu tambahkan
`https://<domain>/api/mcp?key=<MCP_SECRET>` sebagai custom connector di Claude (Claude Code: `claude mcp add --transport http ... --header "Authorization: Bearer <MCP_SECRET>"`).

## Antrian edit massal

Untuk ratusan produk, Claude memasukkan perubahan ke **antrian** (disimpan di Redis) lalu worker di Vercel memprosesnya
sedikit demi sedikit. Anda tidak perlu menunggu di chat, dan batas waktu fungsi Vercel tidak jadi masalah.

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
2. **Vercel Cron** (`vercel.json`) — jaring pengaman, melanjutkan antrian yang macet. Plan Hobby hanya boleh 1x/hari; plan Pro bisa tiap menit (ubah `schedule` jadi `* * * * *`).
   Agar cron lolos autentikasi, set env **`CRON_SECRET` = nilai yang sama dengan `MCP_SECRET`**.
3. **`queue_run`** — Claude menjalankan worker manual ~30 dtk dari chat bila (1) dan (2) tidak berjalan.

> ⚠️ Jangan aktifkan *Vercel Authentication / Deployment Protection* pada domain produksi: worker memanggil dirinya sendiri lewat HTTP dan akan diblokir.

## Dashboard

Buka `https://<domain>/dashboard` dan masuk dengan `MCP_SECRET`. Isinya: daftar toko terhubung + perkiraan tanggal berakhir izin akses
(30 hari sejak token diperbarui, diperpanjang otomatis saat toko dipakai), tombol hubungkan/hubungkan ulang toko, serta progres job antrian
secara langsung (berhasil/gagal/menunggu, ETA, alasan jeda, daftar gagal) dengan kontrol mulai, jeda, lanjutkan, batalkan, coba ulang, rollback, dan jalankan worker.
Panel flash sale belum ada di dashboard; gunakan chat Claude.

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
- Aktifkan **Vercel Deployment Protection** hanya untuk preview; jangan untuk produksi, karena Claude perlu mengakses `/api/mcp`.

## Catatan penting

- Endpoint & nama field ditulis dari dokumentasi Shopee Open Platform v2 tetapi **belum diuji ke toko nyata**
  (butuh kredensial). Uji dulu dengan `SHOPEE_ENV=sandbox` atau 1-2 produk. Modul flash sale paling perlu diverifikasi.
- Akses API produk/flash sale tergantung izin (permission) app Anda di Shopee Open Platform.
- Kecepatan antrian ±75-90 produk/menit (batas rate limit Shopee + durasi fungsi); 500 produk ≈ 6 menit.
- Plan Hobby Vercel membatasi fungsi hingga 60 dtk; worker dirancang muat di dalamnya.
- Akun utama (*main account*) Shopee belum didukung; otorisasi dilakukan per toko.

## Pengembangan lokal

```bash
npm install
cp .env.example .env.local      # isi; tanpa Redis, data disimpan di .data/ (di-gitignore)
npm run dev                     # http://localhost:3000/api/mcp?key=...
npm test                        # 47 tes: signing, SEO, auth, bulk, antrian, dashboard
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
src/lib/store.ts                   Upstash Redis (prod) / file (lokal)
tests/
```

Versi Python/CLI sebelumnya (v0.1) masih ada di riwayat git.
