import { SESv2Client } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';
import { createInvitationSesClient } from './invitation-email.provider';
import { AccessContextModule } from '../access-context/access-context.module';
import { InvitationMailService } from './invitation-mail.service';
import { PublicInvitationsController } from './public-invitations.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessContextCacheModule } from '../access-context/cache/access-context-cache.module';
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
    TypeOrmModule.forFeature([
      Invitation,
      Organization,
      Membership,
      Role,
      MembershipRole,
    ]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
    AccessContextModule,
  ],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [
    InvitationsService,
    AccessAuthGuard,
    InvitationMailService,
    {
      provide: SESv2Client,
      inject: [ConfigService],
      useFactory: createInvitationSesClient,
    },
  ],
})
export class InvitationsModule {}
