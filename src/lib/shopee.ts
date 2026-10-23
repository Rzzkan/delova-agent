/** Client Shopee Open Platform v2: signing HMAC-SHA256, OAuth, auto-refresh token. */
import { createHmac } from "node:crypto";
import { Config, loadConfig, requireCredentials } from "./config";
import { KEYS, Store, getStore } from "./store";

export class ShopeeError extends Error {
  constructor(
    public path: string,
    public code: string,
    public detail: string,
    public requestId = "",
  ) {
    super(`${path}: ${code} - ${detail} (request_id=${requestId})`);
  }
}

export interface TokenRecord {
  shop_id: number;
  shop_name?: string;
  access_token: string;
  refresh_token: string;
  expire_at: number; // epoch detik
}

/** Public API: partner_id+path+ts. Shop API: ditambah access_token+shop_id. */
export function makeSign(
  partnerKey: string,
  partnerId: number,
  path: string,
  ts: number,
  accessToken = "",
  shopId: number | string = "",
): string {
  return createHmac("sha256", partnerKey).update(`${partnerId}${path}${ts}${accessToken}${shopId}`).digest("hex");
}

/** Dapat diubah di tes. */
export const rateLimit = { gapMs: 250 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ShopeeClient {
  private lastCall = 0;

  constructor(
    public cfg: Config = loadConfig(),
    private store: Store = getStore(),
  ) {}

  // ---------- OAuth ----------
  authUrl(state: string): string {
    requireCredentials(this.cfg);
    const path = "/api/v2/shop/auth_partner";
    const ts = Math.floor(Date.now() / 1000);
    const sign = makeSign(this.cfg.partnerKey, this.cfg.partnerId, path, ts);
    const redirect = `${this.cfg.baseUrl}/api/shopee/callback?state=${encodeURIComponent(state)}`;
    return `${this.cfg.host}${path}?partner_id=${this.cfg.partnerId}&timestamp=${ts}&sign=${sign}&redirect=${encodeURIComponent(redirect)}`;
  }

  async exchangeCode(code: string, shopId: number): Promise<TokenRecord> {
    const data = await this.rawCall("POST", "/api/v2/auth/token/get", {
      body: { code, shop_id: shopId, partner_id: this.cfg.partnerId },
    });
    const rec = this.toRecord(shopId, data);
    await this.store.hset(KEYS.tokens, String(shopId), rec);
    try {
      const info = await this.get(shopId, "/api/v2/shop/get_shop_info");
      rec.shop_name = info.shop_name;
      await this.store.hset(KEYS.tokens, String(shopId), rec);
    } catch {
      /* nama toko opsional */
    }
    return rec;
  }

  private toRecord(shopId: number, d: Record<string, any>, prev?: TokenRecord): TokenRecord {
    return {
      shop_id: shopId,
      shop_name: prev?.shop_name,
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expire_at: Math.floor(Date.now() / 1000) + Number(d.expire_in ?? 14400) - 120,
    };
  }

  async shops(): Promise<TokenRecord[]> {
    return Object.values(await this.store.hgetall<TokenRecord>(KEYS.tokens));
  }

  /** Tentukan toko: shop_id eksplisit, atau satu-satunya toko yang terhubung. */
  async resolveShop(shopId?: number): Promise<number> {
    const shops = await this.shops();
    if (!shops.length) throw new Error("Belum ada toko terhubung. Buka /api/shopee/connect?key=... di browser.");
    if (shopId) {
      if (!shops.some((s) => s.shop_id === shopId)) {
        throw new Error(`shop_id ${shopId} belum terhubung. Terhubung: ${shops.map((s) => s.shop_id).join(", ")}`);
      }
      return shopId;
    }
    if (shops.length === 1) return shops[0].shop_id;
    throw new Error(
      "Ada beberapa toko; sebutkan shop_id. Pilihan: " +
        shops.map((s) => `${s.shop_id} (${s.shop_name ?? "?"})`).join(", "),
    );
  }

  private async refresh(shopId: number): Promise<TokenRecord> {
    const lockKey = `shopee:refresh:${shopId}`;
    const got = await this.store.lock(lockKey, 20);
    if (!got) {
      // proses lain sedang refresh; tunggu lalu pakai hasilnya
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const r = await this.store.hget<TokenRecord>(KEYS.tokens, String(shopId));
        if (r && r.expire_at > Date.now() / 1000) return r;
      }
      throw new Error("Refresh token macet; coba lagi.");
    }
    try {
      const prev = await this.store.hget<TokenRecord>(KEYS.tokens, String(shopId));
      if (!prev) throw new Error(`Toko ${shopId} belum login.`);
      const data = await this.rawCall("POST", "/api/v2/auth/access_token/get", {
        body: { refresh_token: prev.refresh_token, shop_id: shopId, partner_id: this.cfg.partnerId },
      });
      const rec = this.toRecord(shopId, data, prev); // refresh_token ikut berganti
      await this.store.hset(KEYS.tokens, String(shopId), rec);
      return rec;
    } finally {
      await this.store.unlock(lockKey);
    }
  }

  private async access(shopId: number, force = false): Promise<TokenRecord> {
    let rec = await this.store.hget<TokenRecord>(KEYS.tokens, String(shopId));
    if (!rec) throw new Error(`Toko ${shopId} belum login.`);
    if (force || Date.now() / 1000 >= rec.expire_at) rec = await this.refresh(shopId);
    return rec;
  }

  // ---------- request ----------
  private async rawCall(
    method: "GET" | "POST",
    path: string,
    o: { params?: Record<string, unknown>; body?: unknown; shop?: { token: string; id: number } } = {},
  ): Promise<Record<string, any>> {
    requireCredentials(this.cfg);
    const gap = rateLimit.gapMs - (Date.now() - this.lastCall); // hormati rate limit
    if (gap > 0) await sleep(gap);
    const ts = Math.floor(Date.now() / 1000);
    const q = new URLSearchParams({ partner_id: String(this.cfg.partnerId), timestamp: String(ts) });
    if (o.shop) {
      q.set("access_token", o.shop.token);
      q.set("shop_id", String(o.shop.id));
      q.set("sign", makeSign(this.cfg.partnerKey, this.cfg.partnerId, path, ts, o.shop.token, o.shop.id));
    } else {
      q.set("sign", makeSign(this.cfg.partnerKey, this.cfg.partnerId, path, ts));
    }
    for (const [k, v] of Object.entries(o.params ?? {})) if (v !== undefined) q.set(k, String(v));
    const res = await fetch(`${this.cfg.host}${path}?${q}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(o.body ?? {}) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    this.lastCall = Date.now();
    let data: Record<string, any>;
    try {
      data = await res.json();
    } catch {
      throw new ShopeeError(path, `http_${res.status}`, "respons bukan JSON");
    }
    if (data.error) throw new ShopeeError(path, data.error, data.message ?? "", data.request_id ?? "");
    return data;
  }

  private async shopCall(
    method: "GET" | "POST",
    shopId: number,
    path: string,
    o: { params?: Record<string, unknown>; body?: unknown },
  ) {
    for (let attempt = 0; ; attempt++) {
      const t = await this.access(shopId, attempt > 0);
      try {
        return await this.rawCall(method, path, { ...o, shop: { token: t.access_token, id: shopId } });
      } catch (e) {
        if (attempt === 0 && e instanceof ShopeeError && /access_token|auth/i.test(e.code)) continue;
        throw e;
      }
    }
  }

  get(shopId: number, path: string, params: Record<string, unknown> = {}) {
    return this.shopCall("GET", shopId, path, { params });
  }

  post(shopId: number, path: string, body: unknown) {
    if (this.cfg.readOnly) throw new Error("SHOPEE_READ_ONLY=true: operasi tulis diblokir.");
    return this.shopCall("POST", shopId, path, { body });
  }
}
