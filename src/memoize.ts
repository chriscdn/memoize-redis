import type { RedisClientType } from "redis";
import { isDefined, isNumber, isUndefined } from "@chriscdn/type-guards";

export type MemoizeAsyncRedisOptions<T extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
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

  const resolver =
    options.resolver ?? ((...args: Args) => JSON.stringify(args));

  const inFlight = new Map<string, Promise<Return>>();

  const _fetchAndCache = (skey: string, args: Args): Promise<Return> => {
    const existing = inFlight.get(skey);

    if (isDefined(existing)) {
      return existing;
    } else {
      const promise = (async () => {
        const value = await cb(...args);

        const _ttl = ttl(value, skey);

        if (_ttl > 0 && redisClient.isReady) {
          await redisClient
            .multi()
            .hSet(redisKey, skey, JSON.stringify(value))
            .hpExpire(redisKey, skey, _ttl)
            .exec();
        }

        return value;
      })();

      inFlight.set(skey, promise);

      promise.finally(() => inFlight.delete(skey));

      return promise;
    }
  };

  const memoizedFunction = async (...args: Args): Promise<Return> => {
    const skey = resolver(...args);

    let value: Return | undefined;

    const _value = redisClient.isReady
      ? await redisClient.hGet(redisKey, skey)
      : undefined;

    if (isDefined(_value)) {
      try {
        // now what?
        value = JSON.parse(_value) as Return;
      } catch (e) {
        if (redisClient.isReady) {
          await redisClient.hDel(redisKey, skey);
        }
      }
    }

    if (isUndefined(value)) {
      value = await _fetchAndCache(skey, args);
    }

    return value;
  };

  memoizedFunction.clear = async () => {
    if (redisClient.isReady) {
      await redisClient.del(redisKey);
    }
  };

  memoizedFunction.has = async (...args: Args) => {
    const skey = resolver(...args);

    return redisClient.isReady
      ? Boolean(await redisClient.hExists(redisKey, skey))
      : null;
  };

  memoizedFunction.delete = async (...args: Args) => {
    const skey = resolver(...args);
    if (redisClient.isReady) {
      await redisClient.hDel(redisKey, skey);
    }
  };

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
  memoizedFunction.ttl = async (...args: Args) => {
    const skey = resolver(...args);

    // Returns a list which contains for each field in the request: - `-2` if
    // the field does not exist, or if the key does not exist. - `-1` if the
    // field exists but has no associated expire time. - A positive integer
    // representing the TTL in seconds if the field has an associated expiration
    // time.
    //
    // -3 if redis is offline

    if (redisClient.isReady) {
      const ttls = (await redisClient.hpTTL(redisKey, [skey])) ?? [];

      return isNumber(ttls[0]) ? ttls[0] : -1;
    } else {
      return -3;
    }
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
