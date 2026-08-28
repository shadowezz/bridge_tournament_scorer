import { Redis } from "@upstash/redis";
import type { Backend } from "@/lib/store/backend";

/**
 * Production adapter: one Redis hash per game, one field per board.
 *
 * Field-level writes are independent, so two people at the same table
 * entering different boards can never overwrite each other - there is no
 * read-modify-write of a shared blob anywhere in the path.
 */
export function redisBackend(): Backend {
  const redis = Redis.fromEnv();

  return {
    async readAll(key) {
      const hash = await redis.hgetall<Record<string, unknown>>(key);
      if (!hash || Object.keys(hash).length === 0) return null;

      // The client parses JSON-looking values on the way out; re-serialise so
      // the layer above always sees strings regardless of what was stored.
      return Object.fromEntries(
        Object.entries(hash).map(([field, value]) => [
          field,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      );
    },

    async write(key, fields, remove = []) {
      const pipeline = redis.pipeline();
      if (Object.keys(fields).length > 0) pipeline.hset(key, fields);
      if (remove.length > 0) pipeline.hdel(key, ...remove);
      await pipeline.exec();
    },

    async exists(key) {
      return (await redis.exists(key)) === 1;
    },
  };
}
