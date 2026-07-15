import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessContextCacheModule } from '../access-context/access-context-cache.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Organization } from '../organizations/entities/organization.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { MembershipRole } from '../roles/entities/membership-role.entity';
import { Role } from '../roles/entities/role.entity';
import { Membership } from './entities/membership.entity';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Membership, Organization, Role, MembershipRole]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService, AccessAuthGuard],
  exports: [MembershipsService],
})
export class MembershipsModule {}
