import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports pending migrations', async () => {
    const service = new HealthService({
      query: jest.fn(),
      showMigrations: jest.fn().mockResolvedValue(true),
    } as never);

    await expect(service.ready()).resolves.toEqual({
      status: 'not_ready',
      reason: 'pending_migrations',
    });
  });
});
