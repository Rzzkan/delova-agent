# Panduan Deploy Shopee Agent ke Vercel

Perkiraan waktu: 30-45 menit (sebagian besar menunggu persetujuan/akses di sisi Shopee).
Nama menu di Vercel/Shopee kadang berubah; ikuti maknanya bila labelnya sedikit berbeda.

## Yang perlu disiapkan

- Akun **GitHub** dan akun **Vercel** (login Vercel pakai GitHub paling mudah). Plan Hobby cukup.
- Akun **Shopee Open Platform** (`open.shopee.com`) dengan app yang sudah dibuat.
- **Node.js** di komputer (untuk membuat kunci acak).
- Akses login seller untuk tiap toko: Delova Wardrobe, Delova Kids, Delova Scarf.

---

## Tahap 1. Push kode ke GitHub

Di PowerShell, masuk ke folder proyek:

```powershell
cd "C:\Users\Aditya Nur Riskan N\Delova\Delova Wardrobe\Shopee Agent"
git add -A
git commit -m "Siap deploy: antrian, panduan deploy"
```

Buat repo **privat** di <https://github.com/new> bernama `shopee-agent` (kosong: jangan centang README/.gitignore), lalu:

```powershell
git remote add origin https://github.com/Rzzkan/shopee-agent.git
git branch -M main
git push -u origin main
```

Atau dengan GitHub CLI: `gh repo create shopee-agent --private --source=. --push`

**Cek:** file `.env` tidak ada di repo (hanya `.env.example`).

## Tahap 2. Buat kunci rahasia

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Hasilnya 48 karakter acak. **Simpan di password manager.** Kunci ini dipakai sebagai `MCP_SECRET` dan `CRON_SECRET` (nilainya sama), dan memberi akses penuh ke seluruh toko Anda.

## Tahap 3. Import ke Vercel

1. Buka <https://vercel.com/new> → **Import Git Repository** → pilih `shopee-agent`.
2. Biarkan Framework = **Next.js**, Root Directory = kosong/default.
3. Buka bagian **Environment Variables** dan isi:

| Nama | Nilai |
|---|---|
| `MCP_SECRET` | kunci dari Tahap 2 |
| `CRON_SECRET` | kunci yang **sama** |
| `SHOPEE_ENV` | `sandbox` dulu untuk uji, atau `production` |
| `SHOPEE_READ_ONLY` | `true` (aman untuk uji pertama; ubah ke `false` nanti) |
| `SHOPEE_PARTNER_ID` | isi nanti di Tahap 5 (boleh kosong dulu) |
| `SHOPEE_PARTNER_KEY` | isi nanti di Tahap 5 |

4. Klik **Deploy**. Tunggu sampai selesai. Catat domain produksinya, mis. `https://shopee-agent.vercel.app`. Di panduan ini disebut `DOMAIN`.

## Tahap 4. Pasang Redis (wajib)

Vercel tidak punya disk tetap, jadi token toko dan antrian disimpan di Redis.

1. Di project Vercel: tab **Storage** → **Create Database** (atau Marketplace) → **Upstash** → **Redis**.
2. Pilih region **Singapore**, plan **Free**, lalu **Connect to Project** untuk semua environment.
3. Cek di **Settings → Environment Variables** bahwa `KV_REST_API_URL` dan `KV_REST_API_TOKEN` (atau `UPSTASH_REDIS_REST_*`) sudah muncul.
4. **Redeploy**: tab **Deployments** → titik tiga pada deployment terbaru → **Redeploy**.

## Tahap 5. Siapkan app di Shopee Open Platform

1. Buka console Shopee Open Platform → app Anda.
2. Salin **Partner ID** dan **Partner Key**. Pakai kunci yang sesuai mode: kunci *test* untuk `sandbox`, kunci *live* untuk `production`. Keduanya tidak bisa dipertukarkan.
3. Isi **Redirect URL** dengan persis: `https://DOMAIN/api/shopee/callback`
4. Pastikan app punya izin (permission) untuk modul **Product** dan **Flash Sale / Marketing**. Untuk `production`, app harus sudah disetujui/live oleh Shopee.
5. Di Vercel → **Settings → Environment Variables**, isi `SHOPEE_PARTNER_ID` dan `SHOPEE_PARTNER_KEY`, lalu **Redeploy** lagi.

## Tahap 6. Verifikasi deployment

Ganti `DOMAIN` dan `KUNCI`. Pakai `curl.exe` di PowerShell.

```powershell
# 1) Tanpa kunci harus DITOLAK (401)
curl.exe -i https://DOMAIN/api/mcp

# 2) Dengan kunci harus menampilkan daftar 20 tool
curl.exe -s -X POST "https://DOMAIN/api/mcp?key=KUNCI" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"
```

Bila (1) bukan 401 atau (2) kosong, lihat bagian **Masalah umum**.
Pastikan juga **Settings → Deployment Protection**: domain **produksi** tidak boleh diproteksi (worker antrian memanggil dirinya sendiri lewat HTTP).

## Tahap 7. Hubungkan tiap toko

Untuk **setiap** toko (Wardrobe, Kids, Scarf):

1. Buka di browser (jendela *incognito* agar login tidak bercampur): `https://DOMAIN/api/shopee/connect?key=KUNCI`
2. Anda dialihkan ke Shopee. Login sebagai **seller toko tersebut**, lalu **Confirm Authorization**.
3. Muncul halaman **"Toko terhubung"** beserta nama dan ID toko. Ulangi untuk toko berikutnya.

Token berlaku 30 hari dan diperbarui otomatis tiap dipakai. Jika sebuah toko tidak dipakai lebih dari 30 hari, hubungkan ulang.

## Tahap 8. Tambahkan ke Claude

**Claude.ai / aplikasi desktop:** Settings → Connectors → **Add custom connector**
- Nama: `Shopee Agent`
- URL: `https://DOMAIN/api/mcp?key=KUNCI`

**Claude Code:**
```powershell
claude mcp add --transport http shopee-agent https://DOMAIN/api/mcp --header "Authorization: Bearer KUNCI"
```

## Tahap 9. Uji bertahap sebelum edit massal

Lakukan berurutan dan jangan loncat:

1. **Baca saja** (`SHOPEE_READ_ONLY=true`): minta Claude *"daftar toko terhubung"*, lalu *"audit SEO halaman pertama produk Delova Wardrobe"*.
2. **Tulis 1-2 produk:** ubah `SHOPEE_READ_ONLY` ke `false` → Redeploy → minta Claude mengubah judul **2 produk** dengan `apply_product_changes`. Cek hasilnya di Seller Centre, lalu minta **rollback** dan cek lagi.
3. **Antrian kecil:** antrekan 5 produk, jalankan, pantau dengan `queue_status`, coba `rollback`.
4. **Flash sale:** coba di `sandbox` atau satu produk dulu. Nama field flash sale belum diverifikasi terhadap API asli.
5. **Baru edit massal** ratusan produk.

Bila semua uji memakai `sandbox`, ganti `SHOPEE_ENV` ke `production`, ganti Partner ID/Key ke kunci live, **hubungkan ulang** toko (token sandbox tidak berlaku di production), lalu Redeploy.

---

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| `401 unauthorized` di semua endpoint | `MCP_SECRET` belum diisi, kurang dari 16 karakter, atau kunci di URL salah. Redeploy setelah mengubah env. |
| "Redis belum terpasang" | Tahap 4 belum dilakukan atau belum Redeploy. |
| Halaman callback: "State tidak valid" | `MCP_SECRET` berubah antara membuka `/connect` dan kembali dari Shopee, atau Anda membuka callback langsung. Mulai ulang dari `/connect`. |
| Shopee: redirect URL tidak cocok | Redirect URL di console Shopee harus persis `https://DOMAIN/api/shopee/callback`. Domain `.vercel.app` unik per project; jangan pakai URL per-deployment. |
| `invalid_partner_id` / `error_sign` | Partner ID/Key salah, atau kunci test dipakai di `production` (atau sebaliknya). Cek `SHOPEE_ENV`. |
| `error_permission` / `error_auth` | App belum punya izin modul tersebut, atau token toko kedaluwarsa. Minta izin di console, atau hubungkan ulang toko. |
| Job antrian status `paused` | Lihat `pause_reason` di `queue_status`. Perbaiki penyebabnya, lalu `queue_control resume`. |
| Job `queued` tetapi tidak maju | Minta Claude memanggil `queue_run` berulang sampai `more=false`; cek Deployment Protection (Tahap 6). Vercel Cron di Hobby hanya 1x/hari. |
| Perlu ganti kunci (bocor) | Ganti `MCP_SECRET` dan `CRON_SECRET` di Vercel → Redeploy → perbarui URL connector di Claude. |

## Biaya & batas

- Vercel Hobby + Upstash Free cukup untuk pemakaian ini. Antrian ±75-90 produk/menit; 500 produk ≈ 6 menit.
- Fungsi dibatasi 60 detik per eksekusi (worker dirancang muat di dalamnya).
- Untuk cron tiap menit (cadangan antrian lebih sigap), upgrade ke Pro lalu ubah `schedule` di `vercel.json` menjadi `* * * * *`.
