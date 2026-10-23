import { Global, Module } from '@nestjs/common';
import { AccessContextCacheService } from './access-context-cache.service';

@Global()
@Module({
  providers: [AccessContextCacheService],
  exports: [AccessContextCacheService],
})
export class AccessContextCacheModule {}
