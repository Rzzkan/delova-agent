/** Konfigurasi dari environment variables (file .env di VPS, lihat .env.example). */

export const HOSTS = {
  production: "https://partner.shopeemobile.com",
  sandbox: "https://partner.test-stable.shopeemobile.com",
} as const;

export interface Config {
  partnerId: number;
  partnerKey: string;
  env: keyof typeof HOSTS;
  host: string;
  baseUrl: string;
  /** Alamat yang dipakai worker untuk memanggil dirinya sendiri. Docker: http://127.0.0.1:3000. Kosong = baseUrl. */
  workerBaseUrl?: string;
  readOnly: boolean;
  mcpSecret: string;
}

export function loadConfig(): Config {
  const env = (process.env.SHOPEE_ENV ?? "production").toLowerCase();
  if (env !== "production" && env !== "sandbox") {
    throw new Error("SHOPEE_ENV harus 'production' atau 'sandbox'");
  }
  return {
    partnerId: Number(process.env.SHOPEE_PARTNER_ID ?? 0),
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
    env,
    host: HOSTS[env],
    baseUrl: (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    workerBaseUrl: process.env.WORKER_BASE_URL?.replace(/\/$/, "") || undefined,
    readOnly: (process.env.SHOPEE_READ_ONLY ?? "false").toLowerCase() === "true",
    mcpSecret: process.env.MCP_SECRET ?? "",
  };
}

export function requireCredentials(cfg: Config): void {
  if (!cfg.partnerId || !cfg.partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi di environment variables.");
  }
}

/** Kredensial TikTok Shop (Partner Center). Opsional: Shopee tetap jalan tanpa ini. */
export interface TikTokConfig {
  appKey: string;
  appSecret: string;
  serviceId: string;
  apiHost: string;
  authHost: string;
}

export function loadTikTokConfig(): TikTokConfig {
  return {
    appKey: process.env.TIKTOK_APP_KEY ?? "",
    appSecret: process.env.TIKTOK_APP_SECRET ?? "",
    serviceId: process.env.TIKTOK_SERVICE_ID ?? "",
    apiHost: process.env.TIKTOK_API_HOST ?? "https://open-api.tiktokglobalshop.com",
    authHost: process.env.TIKTOK_AUTH_HOST ?? "https://auth.tiktok-shops.com",
  };
}

export const tiktokConfigured = (t: TikTokConfig) => Boolean(t.appKey && t.appSecret);
