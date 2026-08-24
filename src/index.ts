import type { RedisClientType } from "redis";
import {
  isMemoizedAsyncRedis,
  MemoizeAsyncRedis,
  MemoizeAsyncRedisOptions,
} from "./memoize";

type Callback<Args extends unknown[], Return> = (
  ...args: Args
) => Promise<Return>;

type Options<Args extends unknown[], Return> = Omit<
  MemoizeAsyncRedisOptions<Args, Return>,
  "redisClient"
>;

const createRedisMemoizer =
  (redisClient: RedisClientType) =>
  <Args extends unknown[], Return>(
    cb: Callback<Args, Return>,
    options: Options<Args, Return>,
  ) =>
    MemoizeAsyncRedis(cb, { ...options, redisClient });

export { canonicalize, canonicalHash, sha256 } from "./hash-utils";
export { createRedisMemoizer, isMemoizedAsyncRedis };
