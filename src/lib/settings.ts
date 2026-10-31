/**
 * Pengaturan model AI yang bisa diubah dari dashboard (menimpa env). Kunci API disimpan terenkripsi
 * (AES-256-GCM, kunci turunan dari MCP_SECRET) dan TIDAK PERNAH dikembalikan ke browser.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { KEYS, getStore } from "./store";

export interface LlmStored { base_url?: string; model?: string; key_enc?: string; updated_at?: string }

const dataKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "marketplace-agent", "llm-settings", 32));

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}
export function decryptSecret(enc: string, secret: string): string | null {
  try {
    const [iv, tag, ct] = enc.split(".").map((x) => Buffer.from(x, "base64"));
    const d = createDecipheriv("aes-256-gcm", dataKey(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null; // MCP_SECRET berubah atau data rusak
  }
}

export const getLlmStored = async () => (await getStore().hget<LlmStored>(KEYS.settings, "llm")) ?? {};

export async function saveLlmStored(patch: { base_url?: string; model?: string; api_key?: string }, secret: string) {
  const cur = await getLlmStored();
  const next: LlmStored = { ...cur, updated_at: new Date().toISOString() };
  if (patch.base_url !== undefined) next.base_url = patch.base_url;
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.api_key) next.key_enc = encryptSecret(patch.api_key, secret);
  await getStore().hset(KEYS.settings, "llm", next);
}
export async function clearLlmKey() {
  const cur = await getLlmStored();
  delete cur.key_enc;
  await getStore().hset(KEYS.settings, "llm", { ...cur, updated_at: new Date().toISOString() });
}

export const MODEL_RE = /^[\w.:/@+-]{1,120}$/;
