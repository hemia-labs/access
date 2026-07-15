import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async ready() {
    await this.dataSource.query('select 1');
    const pendingMigrations = await this.dataSource.showMigrations();

    if (pendingMigrations) {
      return { status: 'not_ready', reason: 'pending_migrations' };
    }

    return { status: 'ok' };
  }
}
