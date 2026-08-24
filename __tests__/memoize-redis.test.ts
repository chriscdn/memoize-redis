import { describe, expect, test } from "vitest";
import { createRedisMemoizer } from "../src";
import { createClient } from "redis";

const redis = createClient({ url: "redis://localhost:6379" });
const MemoizeRedis = createRedisMemoizer(redis);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Memoization", () => {
  let callCount = 0;

  const m_add = MemoizeRedis(
    async (a: number, b: number) => {
      callCount = callCount + 1;
      return a + b;
    },
    {
      redisKey: "MemoizeRedisTest",
      resolver: (a, b) => JSON.stringify([a, b].toSorted()),
      ttl: () => 200,
    },
  );

  test("redis-offline", async () => {
    expect(m_add.ttl(1, 2)).resolves.toBe(-3);
    // with redis offline, it should still resolve
    expect(callCount).toBe(0);
    expect(m_add(1, 2)).resolves.toBe(3);
    expect(callCount).toBe(1);
  });

  test("addition", async () => {
    await redis.connect();
    await expect(m_add(1, 2)).resolves.toBe(3);
    await expect(m_add.has(2, 1)).resolves.toBe(true);
    await pause(500);
    await expect(m_add.has(2, 1)).resolves.toBe(false);
  });

  test("clear", async () => {
    await expect(m_add(1, 2)).resolves.toBe(3);
    await expect(m_add.has(2, 1)).resolves.toBe(true);
    await m_add.clear();
    await expect(m_add.has(2, 1)).resolves.toBe(false);
  });

  test("ttl & delete", async () => {
    await expect(m_add(1, 2)).resolves.toBe(3);
    await expect(m_add.ttl(1, 2)).resolves.toBeGreaterThan(190);
    await m_add.delete(1, 2);
    await expect(m_add.has(1, 2)).resolves.toBe(false);
  });
});

describe("Background Refresh", () => {
  let callCount = 0;

  const m_add_pause_150 = MemoizeRedis(
    async (a: number, b: number) => {
      await pause(50);
      callCount = callCount + 1;
      return a + b;
    },
    {
      redisKey: "MemoizeRedisTest100",
      resolver: (a, b) => JSON.stringify([a, b].toSorted()),
      ttl: () => 150,
    },
  );

  test("background refresh", async () => {
    // refresh in the background
    m_add_pause_150.refresh(3, 4);
    // should not be cashed yet
    await expect(m_add_pause_150.has(3, 4)).resolves.toBe(false);
    // no calls yet
    expect(callCount).toBe(0);
    await pause(100);
    await expect(m_add_pause_150.has(4, 3)).resolves.toBe(true);
    expect(callCount).toBe(1);
    await pause(100);
    await expect(m_add_pause_150.has(4, 3)).resolves.toBe(false);
    await expect(m_add_pause_150(4, 3)).resolves.toBe(7);
    expect(callCount).toBe(2);
  });
});

describe("null", () => {
  const m_null = MemoizeRedis(async () => null, {
    redisKey: "MemoizeRedisTestNull",
    ttl: () => 1_000,
  });

  test("null", async () => {
    expect(m_null()).resolves.toBe(null);
  });
});

describe("exception", () => {
  const m_exception = MemoizeRedis(
    async () => {
      throw new Error("kaboom");
    },
    {
      redisKey: "MemoizeRedisTestException",
      ttl: () => 1_000,
    },
  );

  test("exception", async () => {
    await expect(m_exception()).rejects.toThrow("kaboom");
  });
});
