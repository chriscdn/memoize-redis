import { describe, expect, test } from "vitest";
import { createRedisMemoizer, createRedisMemoizerNoHash } from "../src";
import { createClient } from "redis";

const redis = createClient({ url: "redis://localhost:6379" });

const { clearNamespace, MemoizeRedis } = createRedisMemoizer(
  redis,
  "Secondary",
);

// const { clearNamespace, MemoizeRedis } = createRedisMemoizerNoHash(redis, "YO");

describe("Memoization", () => {
  let callCount = 0;

  const m_add1 = MemoizeRedis(
    async (a: number, b: number) => {
      callCount = callCount + 1;
      return a + b;
    },
    {
      redisKey: "MemoizeRedisTest1",
      resolver: (a, b) => JSON.stringify([a, b].toSorted()),
      ttl: () => 2_000,
    },
  );

  const m_add2 = MemoizeRedis(
    async (a: number, b: number) => {
      callCount = callCount + 1;
      return a + b;
    },
    {
      redisKey: "MemoizeRedisTest2",
      resolver: (a, b) => JSON.stringify([a, b].toSorted()),
      ttl: () => 2_000,
    },
  );

  test("clearNamespace", async () => {
    await redis.connect();
    await clearNamespace();

    await expect(m_add1.has(1, 2)).resolves.toBe(false);
    await expect(m_add2.has(1, 2)).resolves.toBe(false);

    await expect(m_add1(1, 2)).resolves.toBe(3);
    await expect(m_add2(1, 2)).resolves.toBe(3);

    await expect(m_add1.has(1, 2)).resolves.toBe(true);
    await expect(m_add2.has(1, 2)).resolves.toBe(true);

    await clearNamespace();

    await expect(m_add1.has(1, 2)).resolves.toBe(false);
    await expect(m_add2.has(1, 2)).resolves.toBe(false);
  });
});
