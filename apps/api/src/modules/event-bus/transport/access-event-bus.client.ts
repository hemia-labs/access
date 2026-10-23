import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventBus,
  type EventBusClient,
  type PublishOptions,
} from '@hemia/event-bus';

@Injectable()
export class AccessEventBusClient implements OnModuleDestroy {
  private readonly logger = new Logger(AccessEventBusClient.name);
  private bus: EventBusClient | null = null;
  private connecting: Promise<EventBusClient> | null = null;

  constructor(private readonly config: ConfigService) {}

  async connect() {
    if (this.bus) return this.bus;
    if (this.connecting) return this.connecting;

    const url = this.config.get<string>('eventBus.url');
    if (!url && this.config.get<boolean>('eventBus.required')) {
      throw new Error('AMQP_URL is required in production');
    }
    const serviceName = this.config.getOrThrow<string>('eventBus.serviceName');
    this.connecting = EventBus.connect({
      url: url ?? 'amqp://localhost',
      serviceName,
    })
      .then(async (bus) => {
        await bus.ping();
        this.bus = bus;
        this.logger.log(`Connected to RabbitMQ as ${serviceName}`);
        return bus;
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  async publish<T>(type: string, data: T, options?: PublishOptions) {
    const bus = await this.connect();
    await bus.publish(type, data, options);
  }

  isConnected() {
    return this.bus?.isConnected() ?? false;
  }

  async onModuleDestroy() {
    if (!this.bus) return;
    await this.bus.close();
    this.bus = null;
    this.logger.log('RabbitMQ connection closed');
  }
}
