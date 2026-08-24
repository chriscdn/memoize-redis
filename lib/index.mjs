import { isDefined, isNumber, isString, isUndefined } from "@chriscdn/type-guards";
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
	const inFlight = /* @__PURE__ */ new Map();
	const _fetchAndCache = (skey, args) => {
		const existing = inFlight.get(skey);
		if (isDefined(existing)) return existing;
		else {
			const promise = (async () => {
				const value = await cb(...args);
				const _ttl = ttl(value, skey);
				if (_ttl > 0 && redisClient.isReady) await redisClient.multi().hSet(redisKey, skey, JSON.stringify(value)).hpExpire(redisKey, skey, _ttl).exec();
				return value;
			})();
			inFlight.set(skey, promise);
			promise.finally(() => inFlight.delete(skey)).catch(() => null);
			return promise;
		}
	};
	const memoizedFunction = async (...args) => {
		const skey = resolver(...args);
		let value;
		const _value = redisClient.isReady ? await redisClient.hGet(redisKey, skey) : void 0;
		if (isDefined(_value)) try {
			value = JSON.parse(_value);
		} catch (e) {
			if (redisClient.isReady) await redisClient.hDel(redisKey, skey);
		}
		if (isUndefined(value)) value = await _fetchAndCache(skey, args);
		return value;
	};
	memoizedFunction.clear = async () => {
		if (redisClient.isReady) await redisClient.del(redisKey);
	};
	memoizedFunction.has = async (...args) => {
		const skey = resolver(...args);
		return redisClient.isReady ? Boolean(await redisClient.hExists(redisKey, skey)) : null;
	};
	memoizedFunction.delete = async (...args) => {
		const skey = resolver(...args);
		if (redisClient.isReady) await redisClient.hDel(redisKey, skey);
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
	memoizedFunction.ttl = async (...args) => {
		const skey = resolver(...args);
		if (redisClient.isReady) {
			const ttls = await redisClient.hpTTL(redisKey, [skey]) ?? [];
			return isNumber(ttls[0]) ? ttls[0] : -1;
		} else return -3;
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