import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Membership } from '../memberships/entities/membership.entity';
import { AccessContextCacheModule } from './access-context-cache.module';
import { AccessContextController } from './access-context.controller';
import { AccessContextService } from './access-context.service';
import { AccessJwksController } from './access-jwks.controller';
import { AccessJwksService } from './access-jwks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Membership]),
    IdentityReferencesModule,
    AccessContextCacheModule,
  ],
  controllers: [AccessContextController, AccessJwksController],
  providers: [AccessContextService, AccessJwksService, AccessAuthGuard],
  exports: [AccessContextService],
})
export class AccessContextModule {}
