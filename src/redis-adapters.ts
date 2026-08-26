import { isNumber, isString } from "@chriscdn/type-guards";
import type { RedisClientType } from "redis";

class RedisAdapter {
  constructor(protected redis: RedisClientType) {}

  get isReady() {
    return this.redis.isReady;
  }

  async set({
    hash,
    field,
    value,
    ttl,
  }: {
    hash: string;
    field: string;
    value: string;
    ttl: number;
  }) {
    await this.redis
      .multi()
      .hSet(hash, field, value)
      .hpExpire(hash, field, ttl)
      .exec();
  }

  async get({ hash, field }: { hash: string; field: string }) {
    const [value, _ttl] = await this.redis
      .multi()
      .hGet(hash, field)
      .hpTTL(hash, field)
      .exec();

    const ttl = Array.isArray(_ttl) ? _ttl[0] : null;

    if (isString(value) && isNumber(ttl)) {
      return [value, ttl] as [string, number];
    } else {
      return null;
    }
  }

  del({ hash, field }: { hash: string; field: string }) {
    return this.redis.hDel(hash, field);
  }

  // redis doesn't have a way to clear the entire hash. You need to iterate it.. tbd
  // clear({ hash }: { hash: string }) {
  //   return
  // }

  async exists({ hash, field }: { hash: string; field: string }) {
    return Boolean(await this.redis.hExists(hash, field));
  }

  async ttl({ hash, field }: { hash: string; field: string }) {
    const ttls = await this.redis.hpTTL(hash, field);
    return Array.isArray(ttls) && isNumber(ttls[0]) ? ttls[0] : null;
  }
}

class RedisAdapterNoHash extends RedisAdapter {
  keyify(hash: string, field: string) {
    return `${hash}:::${field}`;
  }

  override async set({
    hash,
    field,
    value,
    ttl,
  }: {
    hash: string;
    field: string;
    value: string;
    ttl: number;
  }) {
    await this.redis
      .multi()
      .set(this.keyify(hash, field), value)
      .pExpire(this.keyify(hash, field), ttl)
      .exec();
  }

  override async get({ hash, field }: { hash: string; field: string }) {
    const [value, ttl] = await this.redis
      .multi()
      .get(this.keyify(hash, field))
      .pTTL(this.keyify(hash, field))
      .exec();

    if (isString(value) && isNumber(ttl)) {
      return [value, ttl] as [string, number];
    } else {
      return null;
    }
  }

  override del({ hash, field }: { hash: string; field: string }) {
    return this.redis.del(this.keyify(hash, field));
  }

  // redis doesn't have a way to clear the entire hash. You need to iterate it.. tbd
  // clear({ hash }: { hash: string }) {
  //   return
  // }

  override async exists({ hash, field }: { hash: string; field: string }) {
    return Boolean(await this.redis.exists(this.keyify(hash, field)));
  }

  override async ttl({ hash, field }: { hash: string; field: string }) {
    const ttl = await this.redis.pTTL(this.keyify(hash, field));
    return isNumber(ttl) ? ttl : null;
  }
}

export { RedisAdapter, RedisAdapterNoHash };
