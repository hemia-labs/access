import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { createClient } from 'redis';
import { AccessContextCacheService } from '../../../../../apps/api/src/modules/access-context/cache/access-context-cache.service';

jest.mock('redis', () => ({ createClient: jest.fn() }));

class FakeRedis extends EventEmitter {
  isOpen = false;
  isReady = false;
  get = jest.fn().mockResolvedValue('{"fresh":true}');
  set = jest.fn().mockResolvedValue('OK');
  del = jest.fn().mockResolvedValue(1);
  ping = jest.fn().mockResolvedValue('PONG');
  connect = jest.fn().mockImplementation(() => {
    this.isOpen = this.isReady = true;
    this.emit('ready');
    return Promise.resolve(this);
  });
  destroy = jest.fn().mockImplementation(() => {
    this.isOpen = this.isReady = false;
  });
}

describe('AccessContextCacheService Redis lifecycle', () => {
  let client: FakeRedis;
  let service: AccessContextCacheService;
  let warning: jest.SpyInstance;
  const originalEnvironment = process.env.NODE_ENV;
  const configure = (host: string | undefined = 'redis.test') => {
    const values: Record<string, unknown> = {
      'access.redis.host': host,
      'access.contextCacheTtlSeconds': 30,
    };
    return new AccessContextCacheService({
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    } as ConfigService);
  };
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    client = new FakeRedis();
    jest.mocked(createClient).mockReturnValue(client as never);
    warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = configure();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    process.env.NODE_ENV = originalEnvironment;
  });

  it('bounds commands and reconnection and never queues offline commands', async () => {
    const initialization = service.onModuleInit();
    const options = jest.mocked(createClient).mock.calls[0][0]!;
    expect(options).toMatchObject({
      disableOfflineQueue: true,
      commandOptions: { timeout: 1000 },
      socket: { connectTimeout: 2000 },
    });
    const reconnect = options.socket!.reconnectStrategy as (
      retries: number,
    ) => number | false;
    await initialization;
    expect(reconnect(0)).toBe(100);
    expect(reconnect(100)).toBe(1000);
    service.onModuleDestroy();
    expect(reconnect(0)).toBe(false);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses the normal cache and configured expiry before any fault', async () => {
    await service.onModuleInit();
    expect(await service.get('key')).toEqual({ fresh: true });
    await service.set('key', { fresh: true });
    expect(client.set).toHaveBeenCalledWith('key', '{"fresh":true}', {
      EX: 30,
    });
    expect(service.key('identity')).toBe('access:context:identity');
    expect(await service.isReady()).toBe(true);
  });

  it('handles error events without leaking details and bypasses stale values after recovery', async () => {
    await service.onModuleInit();
    client.isReady = false;
    expect(() =>
      client.emit('error', new Error('secret redis://password@private')),
    ).not.toThrow();
    client.emit('error', new Error('another secret'));
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /secret|password|private/,
    );
    await expect(service.get('key')).rejects.toMatchObject({ status: 503 });
    await expect(service.set('key', {})).rejects.toMatchObject({ status: 503 });
    await expect(service.del('key')).rejects.toMatchObject({ status: 503 });
    expect(await service.isReady()).toBe(false);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    client.isReady = true;
    client.emit('ready');
    expect(await service.get('key')).toBeNull();
    await service.set('key', {});
    await service.del('key');
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).toHaveBeenCalledWith('key');
    expect(await service.isReady()).toBe(true);
  });

  it.each(['get', 'set', 'del'] as const)(
    'turns a %s command failure into a sanitized 503',
    async (operation) => {
      await service.onModuleInit();
      client[operation].mockRejectedValueOnce(new Error('secret'));
      const pending =
        operation === 'set'
          ? service.set('key', {})
          : service[operation]('key');
      await expect(pending).rejects.toMatchObject({
        status: 503,
        code: 'ACCESS_CONTEXT_CACHE_UNAVAILABLE',
      });
      expect(await service.get('key')).toBeNull();
      expect(warning).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds an in-flight command, discards its socket and reconnects without replay', async () => {
    await service.onModuleInit();
    jest.useFakeTimers();
    client.get.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(service.get('key')).rejects.toMatchObject({
      status: 503,
    });
    await jest.advanceTimersByTimeAsync(1000);
    await result;
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(await service.get('key')).toBeNull();
    expect(await service.isReady()).toBe(true);
  });

  it('rejects malformed cached JSON and stops reusing that cache', async () => {
    await service.onModuleInit();
    client.get.mockResolvedValueOnce('{bad');
    await expect(service.get('key')).rejects.toMatchObject({ status: 503 });
    expect(await service.get('key')).toBeNull();
  });

  it('returns not ready when ping fails', async () => {
    await service.onModuleInit();
    client.ping.mockRejectedValueOnce(new Error('secret'));
    expect(await service.isReady()).toBe(false);
    expect(await service.get('key')).toBeNull();
  });

  it('does not retry an initial failure and destroys the open socket', async () => {
    client.connect.mockImplementationOnce(() => {
      client.isOpen = true;
      const options = jest.mocked(createClient).mock.calls[0][0]!;
      const reconnect = options.socket!.reconnectStrategy as (
        retries: number,
      ) => number | false;
      expect(reconnect(0)).toBe(false);
      client.emit('error', new Error('private secret'));
      return Promise.reject(new Error('private secret'));
    });
    await expect(service.onModuleInit()).rejects.toMatchObject({ status: 503 });
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(await service.isReady()).toBe(false);
  });

  it('destroys a reconnecting socket and rejects operations during shutdown', async () => {
    await service.onModuleInit();
    client.isReady = false;
    service.onModuleDestroy();
    expect(client.destroy).toHaveBeenCalledTimes(1);
    await expect(service.get('key')).rejects.toMatchObject({ status: 503 });
    expect(await service.ping()).toBe(false);
  });

  it('allows no cache only in development and requires Redis in production', async () => {
    service = configure('');
    await service.onModuleInit();
    expect(await service.get('key')).toBeNull();
    await service.set('key', {});
    await service.del('key');
    expect(await service.isReady()).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'production';
    await expect(service.onModuleInit()).rejects.toThrow(
      'ACCESS_REDIS_HOST is required',
    );
    expect(await service.isReady()).toBe(false);
    await expect(service.get('key')).rejects.toMatchObject({ status: 503 });
  });
});
