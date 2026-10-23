import { AccessContextCacheModule } from '../access-context/cache/access-context-cache.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AuditModule } from '../audit/audit.module';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { OutboxModule } from '../outbox/outbox.module';
import { Organization } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    AccessContextCacheModule,
    TypeOrmModule.forFeature([Organization]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, AccessAuthGuard],
})
export class OrganizationsModule {}
