import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { AccessError } from '../../../common/errors/access-error';

@Injectable()
export class AccessContextCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccessContextCacheService.name);
  private client: RedisClientType | null = null;
  private connectedOnce = false;
  private stopping = false;
  private cacheDisabled = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('access.redis.host');
    if (!host) {
      if (process.env.NODE_ENV === 'production')
        throw new Error('ACCESS_REDIS_HOST is required in production');
      return;
    }
    const socket = {
      host,
      port: this.config.get<number>('access.redis.port', 6379),
      connectTimeout: 2_000,
      reconnectStrategy: (retries: number) =>
        this.connectedOnce && !this.stopping
          ? Math.min((retries + 1) * 100, 1_000)
          : false,
    };
    const client = createClient({
      socket: this.config.get<boolean>('access.redis.tls', false)
        ? { ...socket, tls: true }
        : socket,
      username: this.config.get<string>('access.redis.username'),
      password: this.config.get<string>('access.redis.password'),
      database: this.config.get<number>('access.redis.db', 0),
      disableOfflineQueue: true,
      commandOptions: { timeout: 1_000 },
    });
    this.client = client;
    client.on('error', () => this.degrade());
    client.on('ready', () => {
      this.connectedOnce = true;
    });
    try {
      await client.connect();
    } catch {
      this.onModuleDestroy();
      throw this.unavailable();
    }
  }

  onModuleDestroy() {
    this.stopping = true;
    const client = this.client;
    this.client = null;
    if (client?.isOpen) client.destroy();
  }

  async isReady(): Promise<boolean> {
    if (!this.config.get<string>('access.redis.host'))
      return !this.stopping && process.env.NODE_ENV !== 'production';
    return this.ping();
  }

  async ping(): Promise<boolean> {
    const client = this.client;
    if (this.stopping || !client?.isReady) return false;
    try {
      return (await this.command(client, () => client.ping())) === 'PONG';
    } catch {
      this.degrade();
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const client = this.readyClient();
    if (!client || this.cacheDisabled) return null;
    try {
      const value = await this.command(client, () => client.get(key));
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      this.degrade();
      throw this.unavailable();
    }
  }

  async set(key: string, value: unknown) {
    const client = this.readyClient();
    if (!client || this.cacheDisabled) return;
    const ttl = this.config.get<number>('access.contextCacheTtlSeconds', 60);
    try {
      await this.command(client, () =>
        client.set(key, JSON.stringify(value), { EX: ttl }),
      );
    } catch {
      this.degrade();
      throw this.unavailable();
    }
  }

  async del(key: string) {
    const client = this.readyClient();
    if (!client) return;
    try {
      await this.command(client, () => client.del(key));
    } catch {
      this.degrade();
      throw this.unavailable();
    }
  }

  key(identityReferenceId: string) {
    return `access:context:${identityReferenceId}`;
  }

  private readyClient(): RedisClientType | null {
    if (this.stopping) throw this.unavailable();
    if (!this.client) {
      if (
        this.config.get<string>('access.redis.host') ||
        process.env.NODE_ENV === 'production'
      )
        throw this.unavailable();
      return null;
    }
    if (!this.client.isReady) throw this.unavailable();
    return this.client;
  }
  private async command<T>(
    client: RedisClientType,
    execute: () => Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(this.unavailable());
        this.degrade();
        if (client.isOpen) client.destroy();
        if (!this.stopping && this.client === client)
          void client.connect().catch(() => this.degrade());
      }, 1_000);
    });
    try {
      return await Promise.race([execute(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private degrade() {
    if (!this.cacheDisabled && !this.stopping)
      this.logger.warn(
        'Redis tuvo un error; este proceso consultará autorización fresca sin reutilizar la caché cuando reconecte.',
      );
    this.cacheDisabled = true;
  }
  private unavailable() {
    return new AccessError(
      'ACCESS_CONTEXT_CACHE_UNAVAILABLE',
      'La dependencia de contexto no está disponible; intenta de nuevo.',
      503,
    );
  }
}
