import { Semaphore } from "@chriscdn/promise-semaphore";
import type { RedisClientType } from "redis";
import { isDefined, isUndefined } from "@chriscdn/type-guards";
import { Duration } from "@chriscdn/duration";

// type CacheLike<K, V> = Pick<
//   QuickLRU<K, V>,
//   | "clear"
//   | "delete"
//   | "evict"
//   | "expiresIn"
//   | "get"
//   | "has"
//   | "maxAge"
//   | "maxSize"
//   | "peek"
//   | "resize"
//   | "size"
// >;

// const kDefaultMaxSize = 1000;

export type MemoizeAsyncRedisOptions<T extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  // ttl: (value: NoInfer<Return>, key: string) => number;
  // shouldCache?: (value: NoInfer<Return>, key: string) => boolean;
  ttl: (value: Return, key: string) => number;
  shouldCache?: (value: Return, key: string) => boolean;
  resolver?: (...args: T) => string;
};

/**
 * Memoize an asynchronous function.
 */
const MemoizeAsyncRedis = <Args extends unknown[], Return>(
  cb: (...args: Args) => Promise<Return>,
  options: MemoizeAsyncRedisOptions<Args, Return>,
) => {
  const { redisClient, redisKey, ttl } = options;

  const shouldCache = options.shouldCache ?? (() => true);

  const resolver =
    options.resolver ?? ((...args: Args) => JSON.stringify(args));

  const semaphore = new Semaphore();

  const memoizedFunction = async (...args: Args): Promise<Return> => {
    const skey = resolver(...args);

    let value: Return | undefined;

    try {
      await semaphore.acquire(skey);

      const _value = await redisClient.hGet(redisKey, skey);

      if (isDefined(_value)) {
        try {
          // now what?
          value = JSON.parse(_value) as Return;
        } catch (e) {
          await redisClient.hDel(redisKey, skey);
        }
      }

      if (isUndefined(value)) {
        value = await cb(...args);

        if (shouldCache(value, skey)) {
          const maxAge = ttl(value, skey);

          await redisClient
            .multi()
            .hSet(redisKey, skey, JSON.stringify(value))
            .hExpire(
              redisKey,
              skey,
              Duration.toSeconds({ milliseconds: maxAge }),
            )
            .exec();
        }
      }

      return value;
    } finally {
      semaphore.release(skey);
    }
  };

  // memoizedFunction.cache = cache as CacheLike<string, Return>;

  memoizedFunction.clear = async () => await redisClient.del(redisKey);

  memoizedFunction.delete = async (...args: Args) => {
    const skey = resolver(...args);

    await semaphore.acquire(skey);

    try {
      await redisClient.hDel(redisKey, skey);
    } finally {
      semaphore.release(skey);
    }
  };
  // memoizedFunction.expiresIn = (...args: Args) =>
  //   cache.expiresIn(resolver(...args));
  // memoizedFunction.has = (...args: Args) => cache.has(resolver(...args));

  return memoizedFunction;
};

export { MemoizeAsyncRedis };
