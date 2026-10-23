import { HealthService } from '../../../../../apps/api/src/modules/health/health.service';

describe('HealthService', () => {
  function harness(pendingMigrations = false, redisReady = true) {
    const cache = { isReady: jest.fn().mockResolvedValue(redisReady) };
    return {
      cache,
      service: new HealthService(
        {
          query: jest.fn().mockResolvedValue([]),
          showMigrations: jest.fn().mockResolvedValue(pendingMigrations),
        } as never,
        cache as never,
      ),
    };
  }

  it('reports pending migrations before checking Redis', async () => {
    const { service, cache } = harness(true);
    await expect(service.ready()).resolves.toEqual({
      status: 'not_ready',
      reason: 'pending_migrations',
    });
    expect(cache.isReady).not.toHaveBeenCalled();
  });

  it('starts without the removed policy worker pool', async () => {
    const { service } = harness();
    expect(service.startup()).toEqual({ status: 'ok' });
    await expect(service.ready()).resolves.toEqual({ status: 'ok' });
  });

  it('reports a Redis outage', async () => {
    const { service } = harness(false, false);
    await expect(service.ready()).resolves.toEqual({
      status: 'not_ready',
      reason: 'redis_not_ready',
    });
  });
});
