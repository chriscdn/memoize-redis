import { RedisClientType } from "redis";
//#region src/memoize.d.ts
type MemoizeAsyncRedisOptions<T extends unknown[], Return> = {
  redisClient: RedisClientType;
  redisKey: string;
  ttl: (value: Return, key: string) => number;
  shouldCache?: (value: Return, key: string) => boolean;
  resolver?: (...args: T) => string;
};
//#endregion
//#region src/index.d.ts
type Callback<Args extends unknown[], Return> = (...args: Args) => Promise<Return>;
type Options<Args extends unknown[], Return> = Omit<MemoizeAsyncRedisOptions<Args, Return>, "redisClient">;
declare const createRedisMemoizer: (redisClient: RedisClientType) => <Args extends unknown[], Return>(cb: Callback<Args, Return>, options: Options<Args, Return>) => {
  (...args: Args): Promise<Return>;
  clear: () => Promise<number>;
  delete: (...args: Args) => Promise<void>;
};
//#endregion
export { createRedisMemoizer };
//# sourceMappingURL=index.d.mts.map