import canonicalize from "canonicalize";
import { RedisClientType } from "redis";
//#region src/memoize.d.ts
type MemoizeRedisEvent<Args extends unknown[], Return> = {
  type: "hit";
  args: Args;
  key: string;
  value: Return;
} | {
  type: "miss";
  args: Args;
  key: string;
} | {
  type: "fetch";
  args: Args;
  key: string;
  value: Return;
  durationMs: number;
} | {
  type: "background-refresh";
  args: Args;
  key: string;
} | {
  type: "error";
  args?: Args;
  key?: string;
  error: {
    type: "refresh";
    error: unknown;
  } | {
    type: "redis-offline";
  } | {
    type: "redis-error";
    error: unknown;
  } | {
    type: "stringify";
    value: unknown;
    error: unknown;
  } | {
    type: "parse";
    value: unknown;
    error: unknown;
  } | {
    type: "undefined";
    reason: string;
  };
};
type MemoizeAsyncRedisOptions<Args extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
  resolver?: (...args: Args) => string;
  refreshWhen?: (ttl: number, [...args]: Args, value: Return) => boolean;
  onEvent?: (event: MemoizeRedisEvent<Args, Return>) => void;
};
/**
 * Memoize an asynchronous function.
 */
declare const MemoizeAsyncRedis: <Args extends unknown[], Return>(cb: (...args: Args) => Promise<Return>, options: MemoizeAsyncRedisOptions<Args, Return>) => {
  (...args: Args): Promise<Return>;
  clear: () => Promise<number | null>;
  has: (...args: Args) => Promise<boolean | null>;
  delete: (...args: Args) => Promise<void>;
  /**
   * Returns the cache TTL in milliseconds.
   *
   * Returns -3 if redis is not available or a redis error occurred.
   * Returns -2 if the field does not exist, or if the key does not exist.
   * Returns -1 if the field exists but has no associated expiration.
   * Returns the remaining TTL in milliseconds otherwise.
   */
  ttl: (...args: Args) => Promise<number>;
  refresh: (...args: Args) => Promise<Return>;
};
declare const isMemoizedAsyncRedis: (value: unknown) => value is ReturnType<typeof MemoizeAsyncRedis>;
//#endregion
//#region src/hash-utils.d.ts
declare const sha256: (value: string) => string;
declare const canonicalHash: (value: unknown) => string;
//#endregion
//#region src/index.d.ts
type Callback<Args extends unknown[], Return> = (...args: Args) => Promise<Return>;
type Options<Args extends unknown[], Return> = Omit<MemoizeAsyncRedisOptions<Args, Return>, "redisClient">;
declare const createRedisMemoizer: (redisClient: RedisClientType) => <Args extends unknown[], Return>(cb: Callback<Args, Return>, options: Options<Args, Return>) => {
  (...args: Args): Promise<Return>;
  clear: () => Promise<number | null>;
  has: (...args: Args) => Promise<boolean | null>;
  delete: (...args: Args) => Promise<void>;
  ttl: (...args: Args) => Promise<number>;
  refresh: (...args: Args) => Promise<Return>;
};
//#endregion
export { type MemoizeRedisEvent, canonicalHash, canonicalize, createRedisMemoizer, isMemoizedAsyncRedis, sha256 };
//# sourceMappingURL=index.d.mts.map