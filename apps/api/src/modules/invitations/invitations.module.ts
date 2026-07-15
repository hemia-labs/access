import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessContextCacheModule } from '../access-context/access-context-cache.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { MembershipRole } from '../roles/entities/membership-role.entity';
import { Role } from '../roles/entities/role.entity';
import { Invitation } from './entities/invitation.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, Organization, Membership, Role, MembershipRole]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService, AccessAuthGuard],
})
export class InvitationsModule {}
