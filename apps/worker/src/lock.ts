import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Redis distributed lock (SET NX PX + compare-and-delete). Used so singleton loops such
 * as schedulers run on only one worker instance at a time.
 */
export async function withLock<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const token = randomUUID();
  const ok = await redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return undefined;
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      `lock:${key}`,
      token,
    );
  }
}
