import { SystemAuthorizationService } from './authorization/system-authorization.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Membership } from '../memberships/entities/membership.entity';
import { AccessContextCacheModule } from './cache/access-context-cache.module';
import { AccessContextController } from './access-context.controller';
import { AccessContextService } from './access-context.service';
import { AccessJwksController } from './jwks/access-jwks.controller';
import { AccessJwksService } from './jwks/access-jwks.service';
import { ConsoleAuthorizationService } from './authorization/console-authorization.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Membership]),
    IdentityReferencesModule,
    AccessContextCacheModule,
  ],
  controllers: [AccessContextController, AccessJwksController],
  providers: [
    ConsoleAuthorizationService,
    SystemAuthorizationService,
    AccessContextService,
    AccessJwksService,
    AccessAuthGuard,
  ],
  exports: [AccessContextService, AccessJwksService],
})
export class AccessContextModule {}
