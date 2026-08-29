import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which backend `store()` picks is the one decision the app makes from the
 * environment alone, and getting it wrong is invisible until a save fails.
 * These tests pin the choice, and the announcement that goes with it.
 */

const REDIS_VARS = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const MANAGED = ["VERCEL", ...REDIS_VARS] as const;

/**
 * `store()` memoises its backend at module scope, so every case needs a fresh
 * copy of the module rather than a fresh call.
 */
async function loadStore() {
  vi.resetModules();
  return (await import("@/lib/store")).store;
}

describe("backend selection", () => {
  let saved: Partial<Record<(typeof MANAGED)[number], string | undefined>>;

  beforeEach(() => {
    saved = Object.fromEntries(MANAGED.map((name) => [name, process.env[name]]));
    for (const name of MANAGED) delete process.env[name];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const name of MANAGED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    vi.restoreAllMocks();
  });

  // Both naming conventions, because `Redis.fromEnv()` accepts both: the
  // Vercel Marketplace injects the KV_ pair, a database provisioned straight
  // from Upstash the other.
  it.each([
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ])("picks Redis from %s / %s", async (urlVar, tokenVar) => {
    process.env[urlVar] = "https://example.upstash.io";
    process.env[tokenVar] = "token";

    const store = await loadStore();
    expect(() => store()).not.toThrow();
    expect(console.log).toHaveBeenCalledWith("[store] Redis backend");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("picks Redis when only one convention is half-set but the other is complete", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";

    const store = await loadStore();
    expect(() => store()).not.toThrow();
    expect(console.log).toHaveBeenCalledWith("[store] Redis backend");
  });

  it.each(REDIS_VARS)("refuses to start on Vercel with only %s set", async (name) => {
    process.env.VERCEL = "1";
    process.env[name] = "https://example.upstash.io";

    const store = await loadStore();
    expect(() => store()).toThrow(/no Redis credentials in a Vercel deployment/);
  });

  it("falls back to the file backend off Vercel, and says so", async () => {
    const store = await loadStore();
    expect(() => store()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("data/games"));
    expect(console.log).not.toHaveBeenCalledWith("[store] Redis backend");
  });

  it("memoises the backend across calls", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";

    const store = await loadStore();
    expect(store()).toBe(store());
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});
