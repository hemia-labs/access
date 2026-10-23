import { AccessContextCacheService } from '../access-context/cache/access-context-cache.service';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: AccessContextCacheService,
  ) {}

  startup() {
    return { status: 'ok' };
  }

  async ready() {
    await this.dataSource.query('select 1');
    const pendingMigrations = await this.dataSource.showMigrations();

    if (pendingMigrations) {
      return { status: 'not_ready', reason: 'pending_migrations' };
    }

    const startup = this.startup();
    if (startup.status !== 'ok') return startup;
    if (!(await this.cache.isReady()))
      return { status: 'not_ready', reason: 'redis_not_ready' };
    return startup;
  }
}
