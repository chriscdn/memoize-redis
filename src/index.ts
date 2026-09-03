import type { RedisClientType } from "redis";
import {
  isMemoizedAsyncRedis,
  MemoizeAsyncRedis,
  MemoizeAsyncRedisOptions,
  MemoizeRedisEvent,
} from "./memoize";
import { RedisAdapter, RedisAdapterNoHash } from "./redis-adapters";

type Callback<Args extends unknown[], Return> = (
  ...args: Args
) => Promise<Return>;

type Options<Args extends unknown[], Return> = Omit<
  MemoizeAsyncRedisOptions<Args, Return>,
  "redisAdapter"
>;

const createRedisMemoizer = (
  redisClient: RedisClientType,
  namespace: string,
) => {
  const redisAdapter = new RedisAdapter(redisClient, namespace);

  return {
    clearNamespace: () => redisAdapter.clearNamespace(),
    MemoizeRedis: <Args extends unknown[], Return>(
      cb: Callback<Args, Return>,
      options: Options<Args, Return>,
    ) =>
      MemoizeAsyncRedis(cb, {
        ...options,
        redisAdapter,
      }),
  };
};

/**
 * Use this if on Redis < 7.4
 *
 * @param redisClient
 * @returns
 */

const createRedisMemoizerNoHash = (
  redisClient: RedisClientType,
  namespace: string,
) => {
  const redisAdapter = new RedisAdapterNoHash(redisClient, namespace);

  return {
    clearNamespace: () => redisAdapter.clearNamespace(),
    MemoizeRedis: <Args extends unknown[], Return>(
      cb: Callback<Args, Return>,
      options: Options<Args, Return>,
    ) =>
      MemoizeAsyncRedis(cb, {
        ...options,
        redisAdapter,
      }),
  };
};

export { canonicalize, canonicalHash, sha256 } from "./hash-utils";

export {
  createRedisMemoizer,
  isMemoizedAsyncRedis,
  createRedisMemoizerNoHash,
  type MemoizeRedisEvent,
};
