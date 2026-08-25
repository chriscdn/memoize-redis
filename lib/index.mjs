import { isDefined, isDefinedOrNull, isNumber, isString, isUndefined } from "@chriscdn/type-guards";
import shajs from "sha.js";
import canonicalize from "canonicalize";
//#region src/hash-utils.ts
const sha256 = (value) => shajs("sha256").update(value).digest("hex");
const canonicalHash = (value) => {
	const cValue = canonicalize(value);
	if (isString(cValue)) return sha256(cValue);
	else throw new TypeError("canonicalHash value is not JSON serializable");
};
//#endregion
//#region src/memoize.ts
/**
* Memoize an asynchronous function.
*/
const MemoizeAsyncRedis = (cb, options) => {
	const { redisClient, redisKey, ttl } = options;
	const resolver = options.resolver ?? ((...args) => canonicalHash(args));
	const refreshWhen = options.refreshWhen ?? (() => false);
	const onEvent = options.onEvent ?? (() => void 0);
	const inFlight = /* @__PURE__ */ new Map();
	const withRedis = async (fn) => {
		if (redisClient.isReady) try {
			return await fn(redisClient);
		} catch (e) {
			onEvent({
				type: "error",
				error: {
					type: "redis-error",
					error: e
				}
			});
			return null;
		}
		else {
			onEvent({
				type: "error",
				error: { type: "redis-offline" }
			});
			return null;
		}
	};
	const queueRedis = async (fn) => {
		try {
			return await fn(redisClient);
		} catch (e) {
			onEvent({
				type: "error",
				error: {
					type: "redis-error",
					error: e
				}
			});
			return null;
		}
	};
	const stringify = (value, args, skey) => {
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
					error: e
				}
			});
			return null;
		}
	};
	const fetchAndCache = (skey, args) => {
		const existing = inFlight.get(skey);
		if (isDefined(existing)) return existing;
		else {
			const promise = (async () => {
				const t0 = performance.now();
				const value = await cb(...args);
				onEvent({
					type: "fetch",
					args,
					key: skey,
					value,
					durationMs: performance.now() - t0
				});
				if (isUndefined(value)) {
					onEvent({
						type: "error",
						args,
						key: skey,
						error: {
							type: "undefined",
							reason: "Memoized function returned undefined and will not be cached in redis."
						}
					});
					return value;
				} else {
					const _ttl = ttl(value, skey);
					if (_ttl > 0) {
						const serialized = stringify(value, args, skey);
						if (isString(serialized)) await withRedis((redis) => redis.multi().hSet(redisKey, skey, serialized).hpExpire(redisKey, skey, _ttl).exec());
					}
					return value;
				}
			})();
			inFlight.set(skey, promise);
			promise.finally(() => inFlight.delete(skey)).catch(() => null);
			return promise;
		}
	};
	const memoizedFunction = async (...args) => {
		const skey = resolver(...args);
		let value;
		const [_value, _ttl] = await withRedis((redis) => redis.multi().hGet(redisKey, skey).hpTTL(redisKey, skey).exec()) ?? [];
		if (isString(_value)) try {
			value = JSON.parse(_value);
			onEvent({
				type: "hit",
				value,
				args,
				key: skey
			});
		} catch (e) {
			onEvent({
				type: "error",
				args,
				key: skey,
				error: {
					type: "parse",
					value: _value,
					error: e
				}
			});
			await withRedis((redis) => redis.hDel(redisKey, skey));
		}
		else onEvent({
			type: "miss",
			args,
			key: skey
		});
		if (isDefinedOrNull(value)) {
			const ttl = Array.isArray(_ttl) ? _ttl[0] : null;
			if (isNumber(ttl) && refreshWhen(ttl, args, value)) {
				onEvent({
					type: "background-refresh",
					args,
					key: skey
				});
				fetchAndCache(skey, args).catch((e) => {
					onEvent({
						type: "error",
						args,
						key: skey,
						error: {
							type: "refresh",
							error: e
						}
					});
				});
			}
		}
		if (isUndefined(value)) value = await fetchAndCache(skey, args);
		return value;
	};
	memoizedFunction.clear = async () => await queueRedis((redis) => redis.del(redisKey));
	memoizedFunction.has = async (...args) => {
		const skey = resolver(...args);
		const has = await withRedis((redis) => redis.hExists(redisKey, skey));
		return isNumber(has) ? Boolean(has) : null;
	};
	memoizedFunction.delete = async (...args) => {
		const skey = resolver(...args);
		await queueRedis((redis) => redis.hDel(redisKey, skey));
	};
	/**
	* Returns the cache TTL in milliseconds.
	*
	* Returns -3 if redis is not available or a redis error occurred.
	* Returns -2 if the field does not exist, or if the key does not exist.
	* Returns -1 if the field exists but has no associated expiration.
	* Returns the remaining TTL in milliseconds otherwise.
	*/
	memoizedFunction.ttl = async (...args) => {
		const skey = resolver(...args);
		const ttls = await withRedis((redis) => redis.hpTTL(redisKey, [skey])) ?? [];
		return isNumber(ttls[0]) ? ttls[0] : -3;
	};
	memoizedFunction.refresh = async (...args) => {
		const skey = resolver(...args);
		return await fetchAndCache(skey, args);
	};
	return memoizedFunction;
};
const isMemoizedAsyncRedis = (value) => typeof value === "function" && "ttl" in value && typeof value.ttl === "function";
//#endregion
//#region src/index.ts
const createRedisMemoizer = (redisClient) => (cb, options) => MemoizeAsyncRedis(cb, {
	...options,
	redisClient
});
//#endregion
export { canonicalHash, canonicalize, createRedisMemoizer, isMemoizedAsyncRedis, sha256 };

//# sourceMappingURL=index.mjs.map