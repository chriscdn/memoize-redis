import { isBoolean, isDefined, isDefinedOrNull, isNumber, isString, isUndefined } from "@chriscdn/type-guards";
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
	const { redisAdapter, redisKey, ttl } = options;
	const resolver = options.resolver ?? ((...args) => canonicalHash(args));
	const refreshWhen = options.refreshWhen ?? (() => false);
	const onEvent = options.onEvent ?? (() => void 0);
	const inFlight = /* @__PURE__ */ new Map();
	const withRedis = async (fn) => {
		if (redisAdapter.isReady) try {
			return await fn(redisAdapter);
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
			return await fn(redisAdapter);
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
						if (isString(serialized)) await withRedis((redis) => redis.set({
							hash: redisKey,
							field: skey,
							value: serialized,
							ttl: _ttl
						}));
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
		const [_value, _ttl] = await withRedis((redis) => redis.get({
			hash: redisKey,
			field: skey
		})) ?? [];
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
			await withRedis((redis) => redis.del({
				hash: redisKey,
				field: skey
			}));
		}
		else onEvent({
			type: "miss",
			args,
			key: skey
		});
		if (isDefinedOrNull(value) && isNumber(_ttl) && refreshWhen(_ttl, args, value)) {
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
		if (isUndefined(value)) value = await fetchAndCache(skey, args);
		return value;
	};
	memoizedFunction.clear = async () => await queueRedis((redis) => redis.clear({ hash: redisKey }));
	memoizedFunction.has = async (...args) => {
		const skey = resolver(...args);
		const has = await withRedis((redis) => redis.exists({
			hash: redisKey,
			field: skey
		}));
		return isBoolean(has) ? Boolean(has) : null;
	};
	memoizedFunction.delete = async (...args) => {
		const skey = resolver(...args);
		await queueRedis((redis) => redis.del({
			hash: redisKey,
			field: skey
		}));
	};
	memoizedFunction.set = async (args, value) => {
		const skey = resolver(...args);
		const serialized = stringify(value, args, skey);
		const _ttl = ttl(value, skey);
		if (isString(serialized)) await withRedis((redis) => redis.set({
			hash: redisKey,
			field: skey,
			value: serialized,
			ttl: _ttl
		}));
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
		return await withRedis((redis) => redis.ttl({
			hash: redisKey,
			field: skey
		})) ?? -3;
	};
	memoizedFunction.refresh = async (...args) => {
		const skey = resolver(...args);
		return await fetchAndCache(skey, args);
	};
	return memoizedFunction;
};
const isMemoizedAsyncRedis = (value) => typeof value === "function" && "ttl" in value && typeof value.ttl === "function";
//#endregion
//#region src/redis-adapters.ts
var RedisAdapter = class {
	redis;
	namespace;
	constructor(redis, namespace) {
		this.redis = redis;
		this.namespace = namespace;
	}
	get isReady() {
		return this.redis.isReady;
	}
	hashify(hash) {
		return `${this.namespace}:::${hash}`;
	}
	async set({ hash, field, value, ttl }) {
		await this.redis.multi().hSet(this.hashify(hash), field, value).hpExpire(this.hashify(hash), field, ttl).exec();
	}
	async get({ hash, field }) {
		const [value, _ttl] = await this.redis.multi().hGet(this.hashify(hash), field).hpTTL(this.hashify(hash), field).exec();
		const ttl = Array.isArray(_ttl) ? _ttl[0] : null;
		if (isString(value) && isNumber(ttl)) return [value, ttl];
		else return null;
	}
	del({ hash, field }) {
		return this.redis.hDel(this.hashify(hash), field);
	}
	async clear({ hash }) {
		await this.redis.del(this.hashify(hash));
	}
	async exists({ hash, field }) {
		return Boolean(await this.redis.hExists(this.hashify(hash), field));
	}
	async ttl({ hash, field }) {
		const ttls = await this.redis.hpTTL(this.hashify(hash), field);
		return Array.isArray(ttls) && isNumber(ttls[0]) ? ttls[0] : null;
	}
};
var RedisAdapterNoHash = class extends RedisAdapter {
	keyify(hash, field) {
		return `${this.namespace}:::${hash}:::${field}`;
	}
	async set({ hash, field, value, ttl }) {
		await this.redis.multi().set(this.keyify(hash, field), value).pExpire(this.keyify(hash, field), ttl).exec();
	}
	async get({ hash, field }) {
		const [value, ttl] = await this.redis.multi().get(this.keyify(hash, field)).pTTL(this.keyify(hash, field)).exec();
		if (isString(value) && isNumber(ttl)) return [value, ttl];
		else return null;
	}
	del({ hash, field }) {
		return this.redis.del(this.keyify(hash, field));
	}
	async clear({ hash }) {
		for await (const keys of this.redis.scanIterator({
			MATCH: this.keyify(hash, "*"),
			COUNT: 1e3
		})) if (keys.length) await this.redis.unlink(keys);
	}
	async exists({ hash, field }) {
		return Boolean(await this.redis.exists(this.keyify(hash, field)));
	}
	async ttl({ hash, field }) {
		const ttl = await this.redis.pTTL(this.keyify(hash, field));
		return isNumber(ttl) ? ttl : null;
	}
};
//#endregion
//#region src/index.ts
const createRedisMemoizer = (redisClient, namespace) => (cb, options) => {
	const redisAdapter = new RedisAdapter(redisClient, namespace);
	return MemoizeAsyncRedis(cb, {
		...options,
		redisAdapter
	});
};
/**
* Use this if on Redis < 7.4
*
* @param redisClient
* @returns
*/
const createRedisMemoizerNoHash = (redisClient, namespace) => (cb, options) => {
	const redisAdapter = new RedisAdapterNoHash(redisClient, namespace);
	return MemoizeAsyncRedis(cb, {
		...options,
		redisAdapter
	});
};
//#endregion
export { canonicalHash, canonicalize, createRedisMemoizer, createRedisMemoizerNoHash, isMemoizedAsyncRedis, sha256 };

//# sourceMappingURL=index.mjs.map