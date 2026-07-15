import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class AccessContextCacheService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('access.redis.host');
    if (!host) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ACCESS_REDIS_HOST is required in production');
      }
      return;
    }

    const socket = {
      host,
      port: this.config.get<number>('access.redis.port', 6379),
    };
    this.client = createClient({
      socket: this.config.get<boolean>('access.redis.tls', false)
        ? { ...socket, tls: true }
        : socket,
      username: this.config.get<string>('access.redis.username'),
      password: this.config.get<string>('access.redis.password'),
      database: this.config.get<number>('access.redis.db', 0),
    });
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  async get<T>(key: string) {
    const value = await this.client?.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set(key: string, value: unknown) {
    const ttl = this.config.get<number>('access.contextCacheTtlSeconds', 60);
    await this.client?.set(key, JSON.stringify(value), { EX: ttl });
  }

  async del(key: string) {
    await this.client?.del(key);
  }

  key(identityReferenceId: string) {
    return `access:context:${identityReferenceId}`;
  }
}
