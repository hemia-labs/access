import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import accessConfig from './config/access.config';
import databaseConfig from './config/database.config';
import eventBusConfig from './config/event-bus.config';
import { RequestLoggingMiddleware } from './common/observability/request-logging.middleware';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityReferencesModule } from './modules/identity-references/identity-references.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RolesModule } from './modules/roles/roles.module';
import { AccessContextModule } from './modules/access-context/access-context.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ProductsModule } from './modules/products/products.module';
import { EventBusModule } from './modules/event-bus/event-bus.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [accessConfig, databaseConfig, eventBusConfig],
    }),
    DatabaseModule,
    AuditModule,
    OutboxModule,
    HealthModule,
    IdentityReferencesModule,
    OrganizationsModule,
    MembershipsModule,
    RolesModule,
    AccessContextModule,
    InvitationsModule,
    ProductsModule,
    EventBusModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
