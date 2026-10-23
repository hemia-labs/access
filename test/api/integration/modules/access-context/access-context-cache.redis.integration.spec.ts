import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from 'redis';
import { AccessContextCacheService } from '../../../../../apps/api/src/modules/access-context/cache/access-context-cache.service';

const redisIntegration =
  process.env.HEMIA_REDIS_RECOVERY_TEST === '1' ? describe : describe.skip;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error('Isolated Redis did not reach the expected state');
}
async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const forced = setTimeout(() => child.kill('SIGKILL'), 2000);
  try {
    await exited;
  } finally {
    clearTimeout(forced);
  }
}

redisIntegration('AccessContextCacheService with disposable Redis', () => {
  it('survives disconnect, recovers with fresh-data cache misses and bounds an unresponsive command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hemia-redis-recovery-'));
    const port = await unusedPort();
    let child: ChildProcess | undefined;
    let service: AccessContextCacheService | undefined;
    let observer: ReturnType<typeof createClient> | undefined;
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const launch = async () => {
      const redisProcess = spawn(
        process.env.HEMIA_REDIS_SERVER ?? 'redis-server',
        [
          '--bind',
          '127.0.0.1',
          '--port',
          String(port),
          '--save',
          '',
          '--appendonly',
          'no',
          '--dir',
          directory,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      child = redisProcess;
      let output = '';
      redisProcess.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      redisProcess.stderr.resume();
      let failure = false;
      redisProcess.on('error', () => {
        failure = true;
      });
      await until(() => {
        if (failure || redisProcess.exitCode !== null)
          throw new Error('Disposable Redis failed to start');
        return output.includes('Ready to accept connections');
      });
    };
    try {
      await launch();
      const values: Record<string, unknown> = {
        'access.redis.host': '127.0.0.1',
        'access.redis.port': port,
      };
      service = new AccessContextCacheService({
        get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      } as ConfigService);
      await service.onModuleInit();
      await service.set('isolated:key', { old: true });
      expect(await service.get('isolated:key')).toEqual({ old: true });
      await stop(child);
      await until(async () => !(await service!.isReady()));
      await expect(service.get('isolated:key')).rejects.toMatchObject({
        status: 503,
      });
      await expect(service.set('isolated:key', {})).rejects.toMatchObject({
        status: 503,
      });
      await expect(service.del('isolated:key')).rejects.toMatchObject({
        status: 503,
      });
      await launch();
      await until(() => service!.isReady());
      observer = createClient({
        socket: { host: '127.0.0.1', port, reconnectStrategy: false },
        disableOfflineQueue: true,
      });
      observer.on('error', () => {});
      await observer.connect();
      await observer.set('isolated:key', '{"stale":true}');
      expect(await service.get('isolated:key')).toBeNull();
      await service.set('isolated:key', { replacement: true });
      expect(await observer.get('isolated:key')).toBe('{"stale":true}');
      await service.del('isolated:key');
      expect(await observer.get('isolated:key')).toBeNull();
      expect(warning).toHaveBeenCalledTimes(1);
      await observer.sendCommand(['CLIENT', 'PAUSE', '1800', 'ALL']);
      const started = Date.now();
      expect(await service.ping()).toBe(false);
      expect(Date.now() - started).toBeLessThan(1700);
      await until(() => service!.isReady());
      service.onModuleDestroy();
      expect(await service.isReady()).toBe(false);
      await expect(service.get('isolated:key')).rejects.toMatchObject({
        status: 503,
      });
    } finally {
      service?.onModuleDestroy();
      if (observer?.isOpen) observer.destroy();
      await stop(child);
      warning.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  }, 25000);
});
