import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessContextCacheModule } from '../access-context/cache/access-context-cache.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Membership } from '../memberships/entities/membership.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { MembershipRole } from './entities/membership-role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      Permission,
      RolePermission,
      Membership,
      MembershipRole,
    ]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [RolesController],
  providers: [RolesService, AccessAuthGuard],
  exports: [RolesService],
})
export class RolesModule {}
