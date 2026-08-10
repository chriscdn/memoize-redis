import { Semaphore } from "@chriscdn/promise-semaphore";
import { isDefined, isUndefined } from "@chriscdn/type-guards";
import { Duration } from "@chriscdn/duration";
//#region src/memoize.ts
/**
* Memoize an asynchronous function.
*/
const MemoizeAsyncRedis = (cb, options) => {
	const { redisClient, redisKey, ttl } = options;
	const shouldCache = options.shouldCache ?? (() => true);
	const resolver = options.resolver ?? ((...args) => JSON.stringify(args));
	const semaphore = new Semaphore();
	const memoizedFunction = async (...args) => {
		const skey = resolver(...args);
		let value;
		try {
			await semaphore.acquire(skey);
			const _value = await redisClient.hGet(redisKey, skey);
			if (isDefined(_value)) try {
				value = JSON.parse(_value);
			} catch (e) {
				await redisClient.hDel(redisKey, skey);
			}
			if (isUndefined(value)) {
				value = await cb(...args);
				if (shouldCache(value, skey)) {
					const maxAge = ttl(value, skey);
					await redisClient.multi().hSet(redisKey, skey, JSON.stringify(value)).hExpire(redisKey, skey, Duration.toSeconds({ milliseconds: maxAge })).exec();
				}
			}
			return value;
		} finally {
			semaphore.release(skey);
		}
	};
	memoizedFunction.clear = async () => await redisClient.del(redisKey);
	memoizedFunction.delete = async (...args) => {
		const skey = resolver(...args);
		await semaphore.acquire(skey);
		try {
			await redisClient.hDel(redisKey, skey);
		} finally {
			semaphore.release(skey);
		}
	};
	return memoizedFunction;
};
//#endregion
//#region src/index.ts
const createRedisMemoizer = (redisClient) => (cb, options) => MemoizeAsyncRedis(cb, {
	...options,
	redisClient
});
//#endregion
export { createRedisMemoizer };

//# sourceMappingURL=index.mjs.map