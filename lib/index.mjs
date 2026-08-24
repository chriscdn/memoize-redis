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
	const inFlight = /* @__PURE__ */ new Map();
	const _fetchAndCache = (skey, args) => {
		const existing = inFlight.get(skey);
		if (isDefined(existing)) return existing;
		else {
			const promise = (async () => {
				const value = await cb(...args);
				if (isUndefined(value)) throw new TypeError("Memoized function returned undefined");
				else {
					const _ttl = ttl(value, skey);
					if (_ttl > 0) await redisClient.multi().hSet(redisKey, skey, JSON.stringify(value)).hpExpire(redisKey, skey, _ttl).exec().catch(() => null);
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
		const [_value, _ttl] = await redisClient.multi().hGet(redisKey, skey).hpTTL(redisKey, skey).exec().catch(() => [null, null]);
		if (isString(_value)) try {
			value = JSON.parse(_value);
		} catch {
			await redisClient.hDel(redisKey, skey).catch(() => null);
		}
		if (isDefinedOrNull(value)) {
			const ttl = Array.isArray(_ttl) ? _ttl[0] : null;
			if (isNumber(ttl) && refreshWhen(ttl, args, value)) _fetchAndCache(skey, args).catch(() => null);
		}
		if (isUndefined(value)) value = await _fetchAndCache(skey, args);
		return value;
	};
	memoizedFunction.clear = async () => await redisClient.del(redisKey);
	memoizedFunction.has = async (...args) => {
		const skey = resolver(...args);
		return Boolean(await redisClient.hExists(redisKey, skey));
	};
	memoizedFunction.delete = async (...args) => {
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
	memoizedFunction.ttl = async (...args) => {
		const skey = resolver(...args);
		const ttls = await redisClient.hpTTL(redisKey, [skey]) ?? [];
		return isNumber(ttls[0]) ? ttls[0] : -1;
	};
	memoizedFunction.refresh = async (...args) => {
		const skey = resolver(...args);
		return await _fetchAndCache(skey, args);
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