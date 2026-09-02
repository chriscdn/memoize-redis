import {
  isBoolean,
  isDefined,
  isDefinedOrNull,
  isNumber,
  isString,
  isUndefined,
} from "@chriscdn/type-guards";
import { canonicalHash } from "./hash-utils";
import { RedisAdapter } from "./redis-adapters";

export type MemoizeRedisEvent<Args extends unknown[], Return> =
  | {
      type: "hit";
      args: Args;
      key: string;
      value: Return;
    }
  | {
      type: "miss";
      args: Args;
      key: string;
    }
  | {
      type: "fetch";
      args: Args;
      key: string;
      value: Return;
      durationMs: number;
    }
  | {
      type: "background-refresh";
      args: Args;
      key: string;
    }
  | {
      type: "error";
      args?: Args;
      key?: string;
      error:
        | {
            type: "refresh";
            error: unknown;
          }
        | {
            type: "redis-offline";
          }
        | {
            type: "redis-error";
            error: unknown;
          }
        | {
            type: "stringify";
            value: unknown;
            error: unknown;
          }
        | {
            type: "parse";
            value: unknown;
            error: unknown;
          }
        | {
            type: "undefined";
            reason: string;
          };
    };

export type MemoizeAsyncRedisOptions<Args extends unknown[], Return> = {
  redisAdapter: RedisAdapter;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
  resolver?: (...args: Args) => string;
  refreshWhen?: (ttl: number, [...args]: Args, value: Return) => boolean;
  onEvent?: (event: MemoizeRedisEvent<Args, Return>) => void;
};

/**
 * Memoize an asynchronous function.
 */
const MemoizeAsyncRedis = <Args extends unknown[], Return>(
  cb: (...args: Args) => Promise<Return>,
  options: MemoizeAsyncRedisOptions<Args, Return>,
) => {
  const { redisAdapter, redisKey, ttl } = options;

  const resolver = options.resolver ?? ((...args: Args) => canonicalHash(args));
  const refreshWhen = options.refreshWhen ?? (() => false);
  const onEvent = options.onEvent ?? (() => undefined);

  const inFlight = new Map<string, Promise<Return>>();

  const withRedis = async <T>(
    fn: (redis: RedisAdapter) => Promise<T>,
  ): Promise<T | null> => {
    if (redisAdapter.isReady) {
      try {
        return await fn(redisAdapter);
      } catch (e) {
        onEvent({ type: "error", error: { type: "redis-error", error: e } });
        return null;
      }
    } else {
      onEvent({ type: "error", error: { type: "redis-offline" } });
      return null;
    }
  };

  const queueRedis = async <T>(
    fn: (redis: RedisAdapter) => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await fn(redisAdapter);
    } catch (e) {
      onEvent({ type: "error", error: { type: "redis-error", error: e } });
      return null;
    }
  };

  const stringify = (value: unknown, args: Args, skey: string) => {
    try {
      return JSON.stringify(value);
    } catch (e) {
      onEvent({
        type: "error",
        args,
        key: skey,
        error: {
          type: "stringify",
          value,
          error: e,
        },
      });

      return null;
    }
  };

  const fetchAndCache = (skey: string, args: Args): Promise<Return> => {
    const existing = inFlight.get(skey);

    if (isDefined(existing)) {
      return existing;
    } else {
      const promise = (async () => {
        const t0 = performance.now();

        const value = await cb(...args);

        onEvent({
          type: "fetch",
          args,
          key: skey,
          value,
          durationMs: performance.now() - t0,
        });

        if (isUndefined(value)) {
          onEvent({
            type: "error",
            args,
            key: skey,
            error: {
              type: "undefined",
              reason:
                "Memoized function returned undefined and will not be cached in redis.",
            },
          });

          return value;
        } else {
          const _ttl = ttl(value, skey);

          if (_ttl > 0) {
            const serialized = stringify(value, args, skey);

            if (isString(serialized)) {
              await withRedis((redis) =>
                redis.set({
                  hash: redisKey,
                  field: skey,
                  value: serialized,
                  ttl: _ttl,
                }),
              );
            }
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

    const [_value, _ttl] =
      (await withRedis((redis) =>
        redis.get({
          hash: redisKey,
          field: skey,
        }),
      )) ?? [];

    if (isString(_value)) {
      try {
        value = JSON.parse(_value) as Return;
        onEvent({
          type: "hit",
          value,
          args,
          key: skey,
        });
      } catch (e) {
        onEvent({
          type: "error",
          args,
          key: skey,
          error: { type: "parse", value: _value, error: e },
        });

        await withRedis((redis) =>
          redis.del({
            hash: redisKey,
            field: skey,
          }),
        );
      }
    } else {
      onEvent({ type: "miss", args, key: skey });
    }

    if (
      isDefinedOrNull(value) &&
      isNumber(_ttl) &&
      refreshWhen(_ttl, args, value)
    ) {
      onEvent({
        type: "background-refresh",
        args,
        key: skey,
      });

      fetchAndCache(skey, args).catch((e) => {
        onEvent({
          type: "error",
          args,
          key: skey,
          error: {
            type: "refresh",
            error: e,
          },
        });
      });
    }

    if (isUndefined(value)) {
      value = await fetchAndCache(skey, args);
    }

    return value;
  };

  memoizedFunction.clear = async () =>
    await queueRedis((redis) => redis.clear({ hash: redisKey }));

  memoizedFunction.has = async (...args: Args) => {
    const skey = resolver(...args);
    const has = await withRedis((redis) =>
      redis.exists({ hash: redisKey, field: skey }),
    );
    return isBoolean(has) ? Boolean(has) : null;
  };

  memoizedFunction.delete = async (...args: Args) => {
    const skey = resolver(...args);
    await queueRedis((redis) => redis.del({ hash: redisKey, field: skey }));
  };

  memoizedFunction.set = async (args: Args, value: Return) => {
    const skey = resolver(...args);

    const serialized = stringify(value, args, skey);
    const _ttl = ttl(value, skey);

    if (isString(serialized)) {
      await withRedis((redis) =>
        redis.set({
          hash: redisKey,
          field: skey,
          value: serialized,
          ttl: _ttl,
        }),
      );
    }
  };

  /**
   * Returns the cache TTL in milliseconds.
   *
   * Returns -3 if redis is not available or a redis error occurred.
   * Returns -2 if the field does not exist, or if the key does not exist.
   * Returns -1 if the field exists but has no associated expiration.
   * Returns the remaining TTL in milliseconds otherwise.
   */
  memoizedFunction.ttl = async (...args: Args) => {
    const skey = resolver(...args);

    const _ttl = await withRedis((redis) =>
      redis.ttl({ hash: redisKey, field: skey }),
    );

    return _ttl ?? -3;
  };

  memoizedFunction.refresh = async (...args: Args) => {
    const skey = resolver(...args);
    return await fetchAndCache(skey, args);
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
