import { RedisClientType } from "redis";
//#region src/memoize.d.ts
type MemoizeAsyncRedisOptions<T extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
  shouldCache?: (value: Return, key: string) => boolean;
  resolver?: (...args: T) => string;
};
/**
 * Memoize an asynchronous function.
 */
declare const MemoizeAsyncRedis: <Args extends unknown[], Return>(cb: (...args: Args) => Promise<Return>, options: MemoizeAsyncRedisOptions<Args, Return>) => {
  (...args: Args): Promise<Return>;
  clear: () => Promise<void>;
  has: (...args: Args) => Promise<boolean | null>;
  delete: (...args: Args) => Promise<void>;
  /**
   * Returns the cache TTL in ms.
   *
   * From redis documentation:
   *
   * The command returns -2 if the key does not exist.
   * The command returns -1 if the key exists but has no associated expire.
   *
   * We've added:
   *
   * The command returns -3 if redis is not available.
   *
   * @param args
   * @returns
   */
  ttl: (...args: Args) => Promise<number>;
  refresh: (...args: Args) => Promise<Return>;
};
declare const isMemoizedAsyncRedis: (value: unknown) => value is ReturnType<typeof MemoizeAsyncRedis>;
//#endregion
//#region src/index.d.ts
type Callback<Args extends unknown[], Return> = (...args: Args) => Promise<Return>;
type Options<Args extends unknown[], Return> = Omit<MemoizeAsyncRedisOptions<Args, Return>, "redisClient">;
declare const createRedisMemoizer: (redisClient: RedisClientType) => <Args extends unknown[], Return>(cb: Callback<Args, Return>, options: Options<Args, Return>) => {
  (...args: Args): Promise<Return>;
  clear: () => Promise<void>;
  has: (...args: Args) => Promise<boolean | null>;
  delete: (...args: Args) => Promise<void>;
  ttl: (...args: Args) => Promise<number>;
  refresh: (...args: Args) => Promise<Return>;
};
//#endregion
export { createRedisMemoizer, isMemoizedAsyncRedis };
//# sourceMappingURL=index.d.mts.map