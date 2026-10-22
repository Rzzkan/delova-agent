/** Konfigurasi dari environment variables (Vercel > Settings > Environment Variables). */

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
  readOnly: boolean;
  mcpSecret: string;
}

export function loadConfig(): Config {
  const env = (process.env.SHOPEE_ENV ?? "production").toLowerCase();
  if (env !== "production" && env !== "sandbox") {
    throw new Error("SHOPEE_ENV harus 'production' atau 'sandbox'");
  }
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return {
    partnerId: Number(process.env.SHOPEE_PARTNER_ID ?? 0),
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
    env,
    host: HOSTS[env],
    baseUrl: (process.env.APP_BASE_URL ?? (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")).replace(/\/$/, ""),
    readOnly: (process.env.SHOPEE_READ_ONLY ?? "false").toLowerCase() === "true",
    mcpSecret: process.env.MCP_SECRET ?? "",
  };
}

export function requireCredentials(cfg: Config): void {
  if (!cfg.partnerId || !cfg.partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi di environment variables.");
  }
}
