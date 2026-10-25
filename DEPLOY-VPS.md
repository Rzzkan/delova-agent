# Deploy Delova Agent di VPS (Docker), berdampingan dengan aplikasi lain

Panduan untuk VPS yang sudah menjalankan **delova.id** (toko), **wh.delova.id** (gudang, MySQL), dan **threads.delova.id** (Threads Hub, `127.0.0.1:3100`), dengan Caddy memegang port 80/443.
Delova Agent (Shopee + TikTok Shop) ditambahkan sebagai **project Docker terpisah** yang tidak menyentuh milik aplikasi lain.

## 1. Apa yang berjalan, dan mengapa tidak bentrok

| Hal | Nilai Delova Agent | Mengapa aman |
|---|---|---|
| Project compose | `delova-agent` | Nama project unik; network & volume otomatis berawalan ini |
| Container | `delova-agent`, `delova-agent-redis` | Nama unik; `preflight.sh` memeriksa pemakaian ganda |
| Port host | `127.0.0.1:3210` (ubah dengan `AGENT_PORT`) | Hanya loopback, tidak terjangkau internet; beda dari Threads Hub (3100). **Tidak** memakai 80/443 |
| Redis | Container sendiri, network `delova-agent_internal` (`internal: true`) | Tidak ada port terbuka, tidak terlihat aplikasi lain, tidak bentrok dengan Redis/MySQL lain |
| Volume | `delova-agent_redis-data` | Satu-satunya data: token toko & antrian |
| Alias di network proxy | `delova-agent` | Hanya service aplikasi yang disambung ke network proxy, dengan alias unik; Redis tidak ikut |
| Sumber daya | app 384 MB / 0,5 CPU, Redis 192 MB / 0,25 CPU | Tidak mengganggu aplikasi lain |
| Subdomain | `agent.delova.id` (contoh) | Satu blok baru di Caddy; blok lain tidak diubah |

## 2. Sebelum mulai

1. **DNS:** buat A record `agent.delova.id` (atau nama lain) ke IP VPS.
2. **Shopee Open Platform:** Redirect URL = `https://agent.delova.id/api/shopee/callback`.
3. **TikTok Shop Partner Center (opsional):** Redirect URL = `https://agent.delova.id/api/tiktok/callback`; siapkan App Key, App Secret, Service ID.
4. **Swap/RAM:** build image butuh ±1 GB RAM bebas. Bila VPS kecil dan sibuk, tambah swap 1-2 GB sementara (lihat Masalah umum).

## 3. Langkah deploy

```bash
# 1. Taruh kode di VPS (contoh: git clone dari repo Anda, atau scp)
cd ~/apps && git clone <URL-REPO> delova-agent && cd delova-agent

# 2. Isi konfigurasi
cp .env.example .env
chmod 600 .env
openssl rand -hex 24          # hasilnya untuk MCP_SECRET
nano .env                     # isi MCP_SECRET, SHOPEE_*, TIKTOK_*, APP_BASE_URL=https://agent.delova.id

# 3. Cek bentrok (hanya membaca, aman dijalankan kapan saja)
bash deploy/preflight.sh

# 4. Build & jalankan
docker compose up -d --build
docker compose ps             # keduanya harus "healthy"
curl -s http://127.0.0.1:3210/api/health      # {"ok":true,"store":"redis"}
```

Bila `preflight.sh` melaporkan **GAGAL**, perbaiki dulu (biasanya: isi `AGENT_PORT=3211` di `.env` bila 3210 sudah terpakai).

## 4. Sambungkan ke Caddy (pilih satu varian)

Cari tahu posisi Caddy:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i caddy
docker inspect <nama-caddy> --format '{{json .NetworkSettings.Networks}}'   # network yang dipakai Caddy
docker network ls
```

Lihat juga bagaimana Threads Hub tersambung (blok `threads.delova.id` di Caddyfile) dan **ikuti pola yang sama**.

**Varian A: Caddy berjalan di Docker (sesuai catatan Anda).** Container Caddy tidak bisa memakai `127.0.0.1` milik host, jadi sambungkan lewat network bersama:

1. Di `.env` tambahkan (isi dengan nama network yang dipakai Caddy):
   ```
   PROXY_NETWORK=<nama-network-caddy>
   COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
   ```
2. `bash deploy/preflight.sh && docker compose up -d`
3. Tambahkan blok dari `deploy/Caddyfile.snippet` (Varian A, `reverse_proxy delova-agent:3000`) ke Caddyfile, lalu:
   ```bash
   docker exec <nama-caddy> caddy validate --config /etc/caddy/Caddyfile
   docker exec <nama-caddy> caddy reload   --config /etc/caddy/Caddyfile
   ```

**Varian B: Caddy di host.** Pakai blok Varian B (`reverse_proxy 127.0.0.1:3210`), lalu `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

Tambahkan blok baru saja; **jangan** mengubah atau menimpa blok delova.id / wh.delova.id / threads.delova.id. HTTPS diurus Caddy otomatis.

## 5. Verifikasi

```bash
curl -s https://agent.delova.id/api/health                      # {"ok":true,"store":"redis"}
curl -s -o /dev/null -w "%{http_code}\n" https://agent.delova.id/api/mcp   # 401 (tanpa kunci), tandanya terlindungi
```

Buka `https://agent.delova.id/dashboard`, masuk dengan `DASHBOARD_PASSWORD` (bila kosong: `MCP_SECRET`), klik **+ Hubungkan Shopee** / **+ Hubungkan TikTok Shop** untuk tiap toko, lalu tambahkan connector di Claude:
`https://agent.delova.id/api/mcp?key=<MCP_SECRET>` (Claude Code: `claude mcp add --transport http delova-agent https://agent.delova.id/api/mcp --header "Authorization: Bearer <MCP_SECRET>"`).

> Dashboard memakai cookie `Secure`, jadi login hanya berfungsi lewat **https** (domain). Untuk akses darurat tanpa domain: `ssh -L 3210:127.0.0.1:3210 user@vps` lalu buka `http://localhost:3210/dashboard` (localhost dianggap aman oleh browser).

## 6. Antrian di VPS

Penjadwal sudah tertanam di aplikasi: tiap 60 detik (`WORKER_INTERVAL_SECONDS`) aplikasi memanggil worker-nya sendiri sebagai jaring pengaman, di atas rantai otomatis setelah `start`/`resume`. Antrian yang sedang berjalan tetap lanjut setelah container di-restart (data ada di Redis).

## 7. Operasional

```bash
docker compose logs -f --tail 100 delova-agent    # log aplikasi
docker compose restart                                   # restart (data aman)
git pull && docker compose up -d --build                 # update versi
docker compose down                                      # hentikan (data tetap ada di volume)
docker compose down -v                                   # HAPUS data (token toko & antrian) - hati-hati
```

**Backup** (token toko ada di sini; simpan di tempat aman, jangan commit):

```bash
docker run --rm -v delova-agent_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/delova-agent-redis-$(date +%F).tgz -C /data .
```

Pulihkan: hentikan stack, `tar xzf` ke volume dengan perintah serupa, lalu `docker compose up -d`. Bila backup hilang, cukup hubungkan ulang toko dari dashboard.

**Rollback versi:** sebelum update, `docker tag delova/agent:local delova/agent:prev`; bila bermasalah, ubah `image:` ke `:prev` lalu `docker compose up -d --no-build`.

## 8. Keamanan

- Aplikasi dan Redis tidak membuka port ke internet. Jangan ubah `127.0.0.1:${AGENT_PORT}:3000` menjadi `"3210:3000"`: port yang dipublikasikan Docker **melewati ufw**.
- Firewall cukup membuka 22, 80, 443.
- `MCP_SECRET` = akses penuh ke toko. Panjang acak, simpan di `.env` (izin 600). Mengganti nilainya mencabut semua sesi dashboard; perbarui URL connector di Claude.
- `DASHBOARD_PASSWORD` (min. 8 karakter) = password login dashboard yang terpisah dari `MCP_SECRET`, jadi kunci connector tidak perlu diketik di browser. Mengganti nilainya mengeluarkan semua sesi. Kosong = login memakai `MCP_SECRET`.
- Login dashboard dibatasi 10 percobaan gagal per IP per 15 menit. IP dibaca dari `X-Forwarded-For` yang ditambahkan Caddy.
- URL connector memuat `?key=`. Pastikan blok Caddy ini tidak mengaktifkan access log yang menyimpan query string, atau pakai header Bearer (Claude Code).
- Redis hanya terjangkau dari container aplikasi (network `internal`), karena itu tanpa password. Bila Anda membuka akses lain ke network itu, tambahkan `--requirepass`.

## 10. Siapkan app Shopee dan TikTok Shop

**Shopee** (Open Platform console, app Anda):
1. Salin **Partner ID** dan **Partner Key** (kunci *test* untuk `sandbox`, kunci *live* untuk `production`), isi `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV` di `.env`.
2. **Redirect URL** = `https://agent.delova.id/api/shopee/callback` (persis).
3. Pastikan app punya izin modul **Product** dan **Flash Sale / Marketing**.
4. Terapkan: `docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d`, lalu di dashboard klik **+ Hubungkan Shopee** untuk tiap toko (login sebagai seller toko itu).

**TikTok Shop** (opsional, lewati bila hanya Shopee):
1. Daftar di **TikTok Shop Partner Center** (partner.tiktokshop.com), buat App seller/custom, minta scope *Product*, *Promotion*, dan *Shop*. Approval bisa memakan waktu.
2. **Redirect URL** = `https://agent.delova.id/api/tiktok/callback`. Catat **App Key**, **App Secret**, **Service ID**.
3. Isi `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` di `.env`, jalankan perintah `up -d` di atas, lalu klik **+ Hubungkan TikTok Shop** di dashboard.

## 11. Uji bertahap sebelum edit massal

1. **Baca saja** (`SHOPEE_READ_ONLY=true`): minta Claude "daftar toko terhubung", lalu "audit SEO halaman pertama produk".
2. **Tulis 1-2 produk:** set `SHOPEE_READ_ONLY=false`, `up -d`, ubah judul 2 produk, cek di Seller Centre, lalu minta rollback.
3. **Antrian kecil:** antrekan 5 produk, pantau dengan `queue_status`, coba rollback.
4. **Flash sale / promosi TikTok:** coba satu produk dulu; endpoint-nya belum diverifikasi ke API asli.
5. Baru edit massal ratusan produk.

Bila tadinya memakai `sandbox`: ganti `SHOPEE_ENV=production`, pakai kunci live, **hubungkan ulang** tiap toko (token sandbox tidak berlaku di production).

## 12. Masalah umum

| Gejala | Penyebab / solusi |
|---|---|
| `preflight` GAGAL port dipakai | Isi `AGENT_PORT=<bebas>` di `.env`, sesuaikan `reverse_proxy` |
| 502 Bad Gateway dari Caddy | Varian proxy salah. Caddy di Docker harus memakai Varian A (nama container, network bersama), bukan `127.0.0.1` |
| `PROXY_NETWORK` error saat `compose up` | Nilai kosong/salah. Cek `docker network ls`; pastikan Caddy memakai network itu |
| Build mati / "Killed" | Kehabisan RAM. `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, build lagi, lalu `sudo swapoff /swapfile` bila perlu |
| Login dashboard tidak mau masuk lewat `http://IP:3210` | Cookie `Secure` butuh https. Pakai domain, atau SSH tunnel (lihat bagian 5) |
| Job `queued` tapi diam | `docker compose logs delova-agent`; pastikan `WORKER_INTERVAL_SECONDS` tidak dihapus dan `MCP_SECRET` ≥16 karakter; atau minta Claude memanggil `queue_run` |
| "TikTok Shop belum dikonfigurasi" | Env `TIKTOK_*` kosong; isi lalu `docker compose up -d` |
| Redirect Shopee/TikTok ditolak | Redirect URL di konsol harus persis `https://<domain>/api/shopee/callback` / `/api/tiktok/callback`, dan `APP_BASE_URL` harus domain yang sama |
