import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessContextCacheModule } from '../access-context/access-context-cache.module';
import { AuditModule } from '../audit/audit.module';
import { Membership } from '../memberships/entities/membership.entity';
import { OrganizationProductInstance } from '../products/entities/organization-product-instance.entity';
import { OrganizationProduct } from '../products/entities/organization-product.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { AccessEventBusClient } from './access-event-bus.client';
import { AccessEventBusConsumer } from './access-event-bus.consumer';
import { AccessEventBusHealthController } from './access-event-bus.health.controller';
import { AccessEventOutboxPublisher } from './access-event-outbox.publisher';
import { AccessProvisioningEventsService } from './access-provisioning-events.service';
import { AccessEventInbox } from './entities/access-event-inbox.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessEventInbox,
      Membership,
      OrganizationProduct,
      OrganizationProductInstance,
      OutboxEvent,
    ]),
    AuditModule,
    OutboxModule,
    AccessContextCacheModule,
  ],
  controllers: [AccessEventBusHealthController],
  providers: [
    AccessEventBusClient,
    AccessEventBusConsumer,
    AccessEventOutboxPublisher,
    AccessProvisioningEventsService,
  ],
})
export class EventBusModule {}
