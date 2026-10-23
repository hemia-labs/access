import { AccessContextCacheModule } from '../access-context/cache/access-context-cache.module';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [AccessContextCacheModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
