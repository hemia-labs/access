import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessContextCacheModule } from '../access-context/access-context-cache.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityReferencesModule } from '../identity-references/identity-references.module';
import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { OrganizationProductInstance } from './entities/organization-product-instance.entity';
import { OrganizationProduct } from './entities/organization-product.entity';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      OrganizationProduct,
      OrganizationProductInstance,
      Organization,
      Membership,
    ]),
    IdentityReferencesModule,
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, AccessAuthGuard],
  exports: [ProductsService],
})
export class ProductsModule {}
