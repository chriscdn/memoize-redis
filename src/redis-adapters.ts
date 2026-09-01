import { isNumber, isString } from "@chriscdn/type-guards";
import type { RedisClientType } from "redis";

class RedisAdapter {
  constructor(
    protected redis: RedisClientType,
    protected namespace: string,
  ) {}

  get isReady() {
    return this.redis.isReady;
  }

  hashify(hash: string) {
    return `${this.namespace}:::${hash}`;
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
      .hSet(this.hashify(hash), field, value)
      .hpExpire(this.hashify(hash), field, ttl)
      .exec();
  }

  async get({ hash, field }: { hash: string; field: string }) {
    const [value, _ttl] = await this.redis
      .multi()
      .hGet(this.hashify(hash), field)
      .hpTTL(this.hashify(hash), field)
      .exec();

    const ttl = Array.isArray(_ttl) ? _ttl[0] : null;

    if (isString(value) && isNumber(ttl)) {
      return [value, ttl] as [string, number];
    } else {
      return null;
    }
  }

  del({ hash, field }: { hash: string; field: string }) {
    return this.redis.hDel(this.hashify(hash), field);
  }

  async clear({ hash }: { hash: string }) {
    await this.redis.del(this.hashify(hash));
  }

  async exists({ hash, field }: { hash: string; field: string }) {
    return Boolean(await this.redis.hExists(this.hashify(hash), field));
  }

  async ttl({ hash, field }: { hash: string; field: string }) {
    const ttls = await this.redis.hpTTL(this.hashify(hash), field);
    return Array.isArray(ttls) && isNumber(ttls[0]) ? ttls[0] : null;
  }
}

class RedisAdapterNoHash extends RedisAdapter {
  keyify(hash: string, field: string) {
    return `${this.namespace}:::${hash}:::${field}`;
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

  override async clear({ hash }: { hash: string }) {
    for await (const keys of this.redis.scanIterator({
      MATCH: this.keyify(hash, "*"),
      COUNT: 1_000,
    })) {
      if (keys.length) {
        await this.redis.unlink(keys);
      }
    }
  }

  override async exists({ hash, field }: { hash: string; field: string }) {
    return Boolean(await this.redis.exists(this.keyify(hash, field)));
  }

  override async ttl({ hash, field }: { hash: string; field: string }) {
    const ttl = await this.redis.pTTL(this.keyify(hash, field));
    return isNumber(ttl) ? ttl : null;
  }
}

export { RedisAdapter, RedisAdapterNoHash };
