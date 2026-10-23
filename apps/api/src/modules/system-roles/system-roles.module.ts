import { LegalTargetValidationClient } from './legal-target-validation.client';
import { SystemRoleCatalogService } from './catalogs/system-role-catalog.service';
import { Module } from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessContextCacheModule } from '../access-context/cache/access-context-cache.module';
import { SystemRoleHistoryController } from './history/system-role-history.controller';
import { SystemRoleHistoryService } from './history/system-role-history.service';
@Module({
  imports: [
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [SystemRoleHistoryController],
  providers: [
    LegalTargetValidationClient,
    AccessAuthGuard,
    SystemRoleHistoryService,
    SystemRoleCatalogService,
  ],
  exports: [SystemRoleHistoryService, LegalTargetValidationClient],
})
export class SystemRolesModule {}
