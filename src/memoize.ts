import type { RedisClientType } from "redis";
import {
  isDefined,
  isDefinedOrNull,
  isNumber,
  isString,
  isUndefined,
} from "@chriscdn/type-guards";
import { canonicalHash } from "./hash-utils";

export type MemoizeAsyncRedisOptions<T extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
  resolver?: (...args: T) => string;
  refreshWhen?: (ttl: number, value: Return) => boolean;
};

/**
 * Memoize an asynchronous function.
 */
const MemoizeAsyncRedis = <Args extends unknown[], Return>(
  cb: (...args: Args) => Promise<Return>,
  options: MemoizeAsyncRedisOptions<Args, Return>,
) => {
  const { redisClient, redisKey, ttl } = options;

  const resolver = options.resolver ?? ((...args: Args) => canonicalHash(args));
  const refreshWhen = options.refreshWhen ?? (() => false);

  const inFlight = new Map<string, Promise<Return>>();

  const _fetchAndCache = (skey: string, args: Args): Promise<Return> => {
    const existing = inFlight.get(skey);

    if (isDefined(existing)) {
      return existing;
    } else {
      const promise = (async () => {
        const value = await cb(...args);

        if (isUndefined(value)) {
          throw new TypeError("Memoized function returned undefined");
        } else {
          const _ttl = ttl(value, skey);

          if (_ttl > 0) {
            await redisClient
              .multi()
              .hSet(redisKey, skey, JSON.stringify(value))
              .hpExpire(redisKey, skey, _ttl)
              .exec()
              .catch(() => null);
          }

          return value;
        }
      })();

      inFlight.set(skey, promise);

      // The .catch() prevents an unhandled rejection from the promise created
      // by .finally(). The original promise still propagates its rejection.
      promise.finally(() => inFlight.delete(skey)).catch(() => null);

      return promise;
    }
  };

  const memoizedFunction = async (...args: Args): Promise<Return> => {
    const skey = resolver(...args);

    let value: Return | undefined;

    const [_value, _ttl] = await redisClient
      .multi()
      .hGet(redisKey, skey)
      .hpTTL(redisKey, skey)
      .exec()
      .catch(() => [null, null]);

    if (isString(_value)) {
      try {
        // now what?
        value = JSON.parse(_value) as Return;
      } catch {
        await redisClient.hDel(redisKey, skey).catch(() => null);
      }
    }

    if (isDefinedOrNull(value)) {
      // This means we got a value from the cache. We now ask refreshWhen if we
      // should refresh in the background

      const ttl = Array.isArray(_ttl) ? _ttl[0] : null;

      if (isNumber(ttl) && refreshWhen(ttl, value)) {
        // this runs in the background, so we catch and bury any errors
        _fetchAndCache(skey, args).catch(() => null);
      }
    }

    if (isUndefined(value)) {
      value = await _fetchAndCache(skey, args);
    }

    return value;
  };

  memoizedFunction.clear = async () => await redisClient.del(redisKey);

  memoizedFunction.has = async (...args: Args) => {
    const skey = resolver(...args);
    return Boolean(await redisClient.hExists(redisKey, skey));
  };

  memoizedFunction.delete = async (...args: Args) => {
    const skey = resolver(...args);
    await redisClient.hDel(redisKey, skey);
  };

  /**
   * Returns the cache TTL in milliseconds.
   *
   * Returns -2 if the field does not exist, or if the key does not exist.
   * Returns -1 if the field exists but has no associated expiration.
   * Returns the remaining TTL in milliseconds otherwise.
   *
   * Redis errors are propagated to the caller.
   */
  memoizedFunction.ttl = async (...args: Args) => {
    const skey = resolver(...args);

    const ttls = (await redisClient.hpTTL(redisKey, [skey])) ?? [];

    return isNumber(ttls[0]) ? ttls[0] : -1;
  };

  memoizedFunction.refresh = async (...args: Args) => {
    const skey = resolver(...args);
    return await _fetchAndCache(skey, args);
  };

  return memoizedFunction;
};

const isMemoizedAsyncRedis = (
  value: unknown,
): value is ReturnType<typeof MemoizeAsyncRedis> =>
  typeof value === "function" &&
  "ttl" in value &&
  typeof value.ttl === "function";

export { MemoizeAsyncRedis, isMemoizedAsyncRedis };
