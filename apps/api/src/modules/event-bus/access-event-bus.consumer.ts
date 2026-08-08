import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventEnvelope } from '@hemia/event-bus';
import {
  LEGAL_RESULT_EVENT_BINDINGS,
  LEGAL_RESULT_EVENT_QUEUE,
  validateLegalProvisioningResult,
  type LegalProvisioningResult,
} from './access-event.contracts';
import { AccessEventBusClient } from './access-event-bus.client';
import { AccessProvisioningEventsService } from './access-provisioning-events.service';

@Injectable()
export class AccessEventBusConsumer implements OnModuleInit {
  private readonly logger = new Logger(AccessEventBusConsumer.name);

  constructor(
    private readonly bus: AccessEventBusClient,
    private readonly events: AccessProvisioningEventsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.config.get<boolean>('eventBus.enabled')) {
      this.logger.warn('Access Event Bus consumer disabled');
      return;
    }

    const eventBus = await this.bus.connect();
    const prefetch = this.config.get<number>('eventBus.prefetch') ?? 10;
    await eventBus.subscribe<LegalProvisioningResult>(
      {
        queue: LEGAL_RESULT_EVENT_QUEUE,
        bindings: [...LEGAL_RESULT_EVENT_BINDINGS],
      },
      async (event: EventEnvelope<LegalProvisioningResult>) => {
        await this.events.consume(event);
      },
      {
        prefetch,
        validate: (data) =>
          validateLegalProvisioningResult(
            'product.organization_product.provisioning_result.v1',
            data,
          ),
      },
    );
    this.logger.log(
      `Subscribed to ${LEGAL_RESULT_EVENT_QUEUE} (${LEGAL_RESULT_EVENT_BINDINGS.join(', ')})`,
    );
  }
}
