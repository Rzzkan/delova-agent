/**
 * Client TikTok Shop Open API (Partner Center, API versi 202309).
 *
 * - Signing: HMAC-SHA256(app_secret, app_secret + path + (param terurut: key+value, tanpa sign & access_token) + body + app_secret)
 * - Header: x-tts-access-token; query: app_key, timestamp, sign, shop_cipher (endpoint level toko)
 * - Token: auth.tiktok-shops.com/api/v2/token/get | refresh (GET). Waktu kedaluwarsa dari TikTok berupa epoch detik.
 * - ID produk TikTok melebihi batas angka JavaScript, jadi SEMUA id diperlakukan sebagai string.
 */
import { createHmac } from "node:crypto";
import { Config, TikTokConfig, loadConfig, loadTikTokConfig } from "./config";
import { KEYS, Store, getStore } from "./store";

export class TikTokError extends Error {
  constructor(
    public path: string,
    public code: string,
    public detail: string,
    public requestId = "",
  ) {
    super(`${path}: ${code} - ${detail} (request_id=${requestId})`);
  }
}

export interface TikTokAuth {
  open_id: string;
  seller_name?: string;
  access_token: string;
  refresh_token: string;
  expire_at: number; // epoch detik, access token
  refresh_expire_at?: number; // epoch detik, refresh token (dari TikTok, bukan perkiraan)
  connected_at?: number;
}

export interface TikTokShopRec {
  shop_id: string;
  shop_cipher: string;
  shop_name?: string;
  region?: string;
  open_id: string;
}

/** String yang ditandatangani: lihat docs Partner Center "Signing your requests". */
export function makeSignTT(
  secret: string,
  path: string,
  query: Record<string, string | number | undefined>,
  body = "",
): string {
  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token" && query[k] !== undefined)
    .sort();
  const params = keys.map((k) => `${k}${query[k]}`).join("");
  const plain = `${secret}${path}${params}${body}${secret}`;
  return createHmac("sha256", secret).update(plain).digest("hex");
}

/** Dapat diubah di tes. */
export const ttRateLimit = { gapMs: 300 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

/** TikTok memberi expire sebagai epoch detik; jaga-jaga bila berupa durasi. */
function absTime(v: unknown, fallbackSeconds: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return nowSec() + fallbackSeconds;
  return n > 1e9 ? n : nowSec() + n;
}

export class TikTokClient {
  private lastCall = 0;

  constructor(
    public cfg: Config = loadConfig(),
    public tt: TikTokConfig = loadTikTokConfig(),
    private store: Store = getStore(),
  ) {}

  private requireCreds() {
    if (!this.tt.appKey || !this.tt.appSecret) {
      throw new Error("TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum diisi di environment variables.");
    }
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.requireCreds();
    if (!this.tt.serviceId) throw new Error("TIKTOK_SERVICE_ID belum diisi (ada di Partner Center > App > Authorization).");
    return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(this.tt.serviceId)}&state=${encodeURIComponent(state)}`;
  }

  private async authCall(path: string, params: Record<string, string>): Promise<Record<string, any>> {
    this.requireCreds();
    const q = new URLSearchParams({ app_key: this.tt.appKey, app_secret: this.tt.appSecret, ...params });
    const res = await fetch(`${this.tt.authHost}${path}?${q}`, { signal: AbortSignal.timeout(20_000) });
    let data: Record<string, any>;
    try {
      data = await res.json();
    } catch {
      throw new TikTokError(path, `http_${res.status}`, "respons bukan JSON");
    }
    if (data.code !== 0) throw new TikTokError(path, String(data.code), data.message ?? "", data.request_id ?? "");
    return data.data ?? {};
  }

  private toAuth(d: Record<string, any>, prev?: TikTokAuth): TikTokAuth {
    return {
      open_id: String(d.open_id ?? prev?.open_id ?? ""),
      seller_name: d.seller_name ?? prev?.seller_name,
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expire_at: absTime(d.access_token_expire_in, 3600) - 120,
      refresh_expire_at: absTime(d.refresh_token_expire_in, 365 * 86400),
      connected_at: prev?.connected_at ?? nowSec(),
    };
  }

  /** Tukar auth code, simpan token seller, lalu simpan semua toko yang diotorisasi. */
  async exchangeCode(code: string): Promise<{ auth: TikTokAuth; shops: TikTokShopRec[] }> {
    const d = await this.authCall("/api/v2/token/get", { auth_code: code, grant_type: "authorized_code" });
    const auth = this.toAuth(d);
    if (!auth.open_id) throw new Error("Respons TikTok tidak berisi open_id.");
    await this.store.hset(KEYS.ttAuth, auth.open_id, auth);
    const list = await this.call("GET", "/authorization/202309/shops", { openId: auth.open_id, shopLevel: false });
    const shops: TikTokShopRec[] = (list.shops ?? []).map((s: any) => ({
      shop_id: String(s.id),
      shop_cipher: String(s.cipher),
      shop_name: s.name,
      region: s.region,
      open_id: auth.open_id,
    }));
    for (const s of shops) await this.store.hset(KEYS.ttShops, s.shop_id, s);
    return { auth, shops };
  }

  private async refresh(openId: string): Promise<TikTokAuth> {
    const lockKey = `tiktok:refresh:${openId}`;
    if (!(await this.store.lock(lockKey, 20))) {
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const r = await this.store.hget<TikTokAuth>(KEYS.ttAuth, openId);
        if (r && r.expire_at > nowSec()) return r;
      }
      throw new Error("Refresh token TikTok macet; coba lagi.");
    }
    try {
      const prev = await this.store.hget<TikTokAuth>(KEYS.ttAuth, openId);
      if (!prev) throw new Error("Seller TikTok belum login.");
      const d = await this.authCall("/api/v2/token/refresh", { refresh_token: prev.refresh_token, grant_type: "refresh_token" });
      const rec = this.toAuth({ ...d, open_id: d.open_id ?? openId }, prev);
      await this.store.hset(KEYS.ttAuth, openId, rec);
      return rec;
    } finally {
      await this.store.unlock(lockKey);
    }
  }

  private async access(openId: string, force = false): Promise<TikTokAuth> {
    let rec = await this.store.hget<TikTokAuth>(KEYS.ttAuth, openId);
    if (!rec) throw new Error("Seller TikTok belum login.");
    if (force || nowSec() >= rec.expire_at) rec = await this.refresh(openId);
    return rec;
  }

  // ---------- toko ----------
  async shops(): Promise<TikTokShopRec[]> {
    return Object.values(await this.store.hgetall<TikTokShopRec>(KEYS.ttShops));
  }

  async auths(): Promise<TikTokAuth[]> {
    return Object.values(await this.store.hgetall<TikTokAuth>(KEYS.ttAuth));
  }

  async resolveShop(shopId?: string | number): Promise<string> {
    const shops = await this.shops();
    if (!shops.length) throw new Error("Belum ada toko TikTok terhubung. Buka /dashboard lalu klik Hubungkan TikTok Shop.");
    if (shopId !== undefined && String(shopId) !== "") {
      if (!shops.some((s) => s.shop_id === String(shopId))) {
        throw new Error(`shop_id ${shopId} belum terhubung. Terhubung: ${shops.map((s) => s.shop_id).join(", ")}`);
      }
      return String(shopId);
    }
    if (shops.length === 1) return shops[0].shop_id;
    throw new Error("Ada beberapa toko TikTok; sebutkan shop_id. Pilihan: " + shops.map((s) => `${s.shop_id} (${s.shop_name ?? "?"})`).join(", "));
  }

  // ---------- request ----------
  private async rawCall(
    method: string,
    path: string,
    o: { query?: Record<string, string | number | undefined>; body?: unknown; token: string; cipher?: string },
  ): Promise<Record<string, any>> {
    this.requireCreds();
    const gap = ttRateLimit.gapMs - (Date.now() - this.lastCall);
    if (gap > 0) await sleep(gap);
    const query: Record<string, string | number | undefined> = {
      ...o.query,
      app_key: this.tt.appKey,
      timestamp: nowSec(),
    };
    if (o.cipher) query.shop_cipher = o.cipher;
    const bodyStr = o.body === undefined || method === "GET" ? "" : JSON.stringify(o.body);
    const sign = makeSignTT(this.tt.appSecret, path, query, bodyStr);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
    q.set("sign", sign);
    const res = await fetch(`${this.tt.apiHost}${path}?${q}`, {
      method,
      headers: { "content-type": "application/json", "x-tts-access-token": o.token },
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(20_000),
    });
    this.lastCall = Date.now();
    let data: Record<string, any>;
    try {
      data = await res.json();
    } catch {
      throw new TikTokError(path, `http_${res.status}`, "respons bukan JSON");
    }
    if (data.code !== 0) throw new TikTokError(path, String(data.code ?? `http_${res.status}`), data.message ?? "", data.request_id ?? "");
    return data.data ?? {};
  }

  /** Panggilan terotentikasi. `shopId` memilih toko (cipher + token seller); `openId` untuk endpoint level seller. */
  async call(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    o: { shopId?: string; openId?: string; shopLevel?: boolean; query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<Record<string, any>> {
    if (method !== "GET" && this.cfg.readOnly) throw new Error("SHOPEE_READ_ONLY=true: operasi tulis diblokir.");
    let openId = o.openId;
    let cipher: string | undefined;
    if (o.shopId) {
      const shop = await this.store.hget<TikTokShopRec>(KEYS.ttShops, o.shopId);
      if (!shop) throw new Error(`Toko TikTok ${o.shopId} belum login.`);
      openId = shop.open_id;
      if (o.shopLevel !== false) cipher = shop.shop_cipher;
    }
    if (!openId) throw new Error("shopId atau openId wajib.");
    for (let attempt = 0; ; attempt++) {
      const t = await this.access(openId, attempt > 0);
      try {
        return await this.rawCall(method, path, { query: o.query, body: o.body, token: t.access_token, cipher });
      } catch (e) {
        if (attempt === 0 && e instanceof TikTokError && isAuthCode(e)) continue; // sekali: refresh token lalu ulangi
        throw e;
      }
    }
  }
}

/** Kode error autentikasi TikTok (105001 token tidak valid, 105002 kedaluwarsa, dst) atau pesan yang mengarah ke izin. */
export function isAuthCode(e: TikTokError): boolean {
  return /^1050\d\d$/.test(e.code) || /access.?token|expired|unauthori[sz]ed|invalid.?token/i.test(e.detail);
}
