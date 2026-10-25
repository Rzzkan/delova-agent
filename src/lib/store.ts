/**
 * Penyimpanan persisten (token Shopee, backup). Vercel serverless tidak punya disk tetap,
 * jadi dipakai Upstash Redis (Vercel Marketplace). Tanpa Redis (dev lokal) dipakai file JSON.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

export interface Store {
  hget<T>(hash: string, field: string): Promise<T | null>;
  hset(hash: string, field: string, value: unknown): Promise<void>;
  /** Tulis banyak field sekaligus (satu request). */
  hsetMany(hash: string, entries: Record<string, unknown>): Promise<void>;
  hgetall<T>(hash: string): Promise<Record<string, T>>;
  /** Kunci sementara untuk mencegah dua refresh token bersamaan. */
  lock(key: string, ttlSeconds: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async hget<T>(hash: string, field: string) {
    return ((await this.r.hget(hash, field)) as T | null) ?? null;
  }
  async hset(hash: string, field: string, value: unknown) {
    await this.r.hset(hash, { [field]: value as never });
  }
  async hsetMany(hash: string, entries: Record<string, unknown>) {
    if (Object.keys(entries).length) await this.r.hset(hash, entries as never);
  }
  async hgetall<T>(hash: string) {
    return ((await this.r.hgetall(hash)) as Record<string, T> | null) ?? {};
  }
  async lock(key: string, ttl: number) {
    return (await this.r.set(key, "1", { nx: true, ex: ttl })) === "OK";
  }
  async unlock(key: string) {
    await this.r.del(key);
  }
}

class FileStore implements Store {
  private file = path.join(process.cwd(), ".data", "store.json");
  private async read(): Promise<Record<string, Record<string, unknown>>> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  private async write(d: unknown) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(d, null, 2), { mode: 0o600 });
  }
  async hget<T>(hash: string, field: string) {
    return ((await this.read())[hash]?.[field] as T | undefined) ?? null;
  }
  async hset(hash: string, field: string, value: unknown) {
    const d = await this.read();
    (d[hash] ??= {})[field] = value;
    await this.write(d);
  }
  async hsetMany(hash: string, entries: Record<string, unknown>) {
    const d = await this.read();
    Object.assign((d[hash] ??= {}), entries);
    await this.write(d);
  }
  async hgetall<T>(hash: string) {
    return ((await this.read())[hash] as Record<string, T> | undefined) ?? {};
  }
  async lock() {
    return true;
  }
  async unlock() {}
}

let instance: Store | null = null;

export function getStore(): Store {
  if (instance) return instance;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    instance = new RedisStore(new Redis({ url, token }));
  } else if (process.env.VERCEL) {
    throw new Error(
      "Redis belum terpasang. Tambahkan integrasi Upstash Redis di Vercel (Storage) lalu redeploy.",
    );
  } else {
    instance = new FileStore();
  }
  return instance;
}

export function setStoreForTests(s: Store | null) {
  instance = s;
}

export const KEYS = {
  tokens: "shopee:tokens",
  backups: "shopee:backups",
  jobs: "shopee:jobs", // id -> JobMeta
  progress: "shopee:jobprogress", // id -> Progress
  items: (id: string) => `shopee:jobitems:${id}`, // item_id -> JobItem
} as const;

/** Jenis penyimpanan aktif, untuk ditampilkan di dashboard. */
export function storeKind(): "redis" | "file" | "belum dipasang" {
  try {
    return getStore() instanceof RedisStore ? "redis" : "file";
  } catch {
    return "belum dipasang";
  }
}
