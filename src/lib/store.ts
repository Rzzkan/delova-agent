/**
 * Penyimpanan persisten (token Shopee, backup). Vercel serverless tidak punya disk tetap,
 * jadi dipakai Upstash Redis (Vercel Marketplace). Tanpa Redis (dev lokal) dipakai file JSON.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import IORedis from "ioredis";
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

/** Redis lewat TCP (REDIS_URL), untuk deploy Docker/VPS. Lock memakai SET NX EX sungguhan. */
class TcpRedisStore implements Store {
  constructor(private r: IORedis) {}
  async hget<T>(hash: string, field: string) {
    const v = await this.r.hget(hash, field);
    return v === null ? null : (JSON.parse(v) as T);
  }
  async hset(hash: string, field: string, value: unknown) {
    await this.r.hset(hash, field, JSON.stringify(value));
  }
  async hsetMany(hash: string, entries: Record<string, unknown>) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) flat[k] = JSON.stringify(v);
    if (Object.keys(flat).length) await this.r.hset(hash, flat);
  }
  async hgetall<T>(hash: string) {
    const raw = await this.r.hgetall(hash);
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v) as T])) as Record<string, T>;
  }
  async lock(key: string, ttl: number) {
    return (await this.r.set(key, "1", "EX", ttl, "NX")) === "OK";
  }
  async unlock(key: string) {
    await this.r.del(key);
  }
}

export function createTcpRedisStore(url: string): Store {
  return new TcpRedisStore(new IORedis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, connectTimeout: 5000 }));
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
  } else if (process.env.REDIS_URL) {
    instance = createTcpRedisStore(process.env.REDIS_URL);
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
  ttAuth: "tiktok:auth", // open_id -> token seller (satu seller bisa punya beberapa toko)
  ttShops: "tiktok:shops", // shop_id -> info toko (cipher, nama, region, open_id)
} as const;

/** Jenis penyimpanan aktif, untuk ditampilkan di dashboard. */
export function storeKind(): "redis" | "file" | "belum dipasang" {
  try {
    return getStore() instanceof FileStore ? "file" : "redis";
  } catch {
    return "belum dipasang";
  }
}
