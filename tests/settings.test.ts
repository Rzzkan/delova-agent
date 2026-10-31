import { beforeEach, describe, expect, it } from "vitest";
import { resolveLlmConfig } from "../src/lib/llm";
import { clearLlmKey, decryptSecret, encryptSecret, getLlmStored, saveLlmStored } from "../src/lib/settings";
import { Store, setStoreForTests } from "../src/lib/store";

class MemStore implements Store {
  d: Record<string, Record<string, any>> = {};
  async hget<T>(h: string, f: string) { const v = this.d[h]?.[f]; return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T); }
  async hset(h: string, f: string, v: unknown) { (this.d[h] ??= {})[f] = JSON.parse(JSON.stringify(v)); }
  async hsetMany(h: string, e: Record<string, unknown>) { for (const [k, v] of Object.entries(e)) await this.hset(h, k, v); }
  async hgetall<T>(h: string) { return JSON.parse(JSON.stringify(this.d[h] ?? {})) as Record<string, T>; }
  async lock() { return true; }
  async unlock() {}
}
const SECRET = "secret-0123456789abcdef";
let mem: MemStore;
beforeEach(() => { mem = new MemStore(); setStoreForTests(mem); delete process.env.LLM_API_KEY; delete process.env.KENARI_API_KEY; delete process.env.LLM_MODEL; delete process.env.LLM_BASE_URL; });

describe("pengaturan AI dari dashboard", () => {
  it("enkripsi bolak-balik; secret salah -> null", () => {
    const enc = encryptSecret("sk-rahasia-1234", SECRET);
    expect(enc).not.toContain("rahasia");
    expect(decryptSecret(enc, SECRET)).toBe("sk-rahasia-1234");
    expect(decryptSecret(enc, "secret-lain-0123456789")).toBeNull();
    expect(encryptSecret("x".repeat(10), SECRET)).not.toBe(encryptSecret("x".repeat(10), SECRET)); // IV acak
  });
  it("kunci tersimpan terenkripsi di store, tidak plaintext", async () => {
    await saveLlmStored({ model: "kenari-x", api_key: "sk-rahasia-1234" }, SECRET);
    expect(JSON.stringify(mem.d)).not.toContain("sk-rahasia-1234");
    const c = await resolveLlmConfig(SECRET);
    expect(c).toMatchObject({ apiKey: "sk-rahasia-1234", model: "kenari-x", baseUrl: "https://kenari.id/v1", source: { key: "web", model: "web", base: "default" } });
  });
  it("web menimpa env; tanpa web memakai env; hapus kunci kembali ke env", async () => {
    process.env.LLM_API_KEY = "env-key-123456"; process.env.LLM_MODEL = "env-model";
    expect((await resolveLlmConfig(SECRET)).source).toMatchObject({ key: "env", model: "env" });
    await saveLlmStored({ model: "web-model", api_key: "web-key-123456", base_url: "https://x.test/v1" }, SECRET);
    expect(await resolveLlmConfig(SECRET)).toMatchObject({ apiKey: "web-key-123456", model: "web-model", baseUrl: "https://x.test/v1" });
    await clearLlmKey();
    expect(await resolveLlmConfig(SECRET)).toMatchObject({ apiKey: "env-key-123456", model: "web-model", source: { key: "env" } });
    expect((await getLlmStored()).key_enc).toBeUndefined();
  });
  it("simpan tanpa api_key tidak menghapus kunci lama; secret berubah -> kunci web tak terbaca, jatuh ke env", async () => {
    await saveLlmStored({ api_key: "web-key-123456" }, SECRET);
    await saveLlmStored({ model: "m2" }, SECRET);
    expect((await resolveLlmConfig(SECRET)).apiKey).toBe("web-key-123456");
    expect((await resolveLlmConfig("secret-baru-0123456789")).source.key).toBe("none");
  });
});
