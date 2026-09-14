import { createClient } from "redis";
import { createRedisMemoizer } from "../src";
const redis = createClient({ url: "redis://localhost:6379" });

const { MemoizeRedis } = createRedisMemoizer(redis, "YO");

const add = () => {
  const t0 = performance.now();

  const results = MemoizeRedis(async (a, b) => a + b, {
    redisKey: "add",
    ttl: () => 60_000,
  });

  console.log("t: ", performance.now() - t0);

  return results;
};

for (let i = 0; i <= 500; i++) {
  add();
}
