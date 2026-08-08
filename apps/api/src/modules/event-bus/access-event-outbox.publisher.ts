import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AccessEventBusClient } from './access-event-bus.client';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';

const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];
const PUBLISH_LEASE_MS = 30_000;

@Injectable()
export class AccessEventOutboxPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccessEventOutboxPublisher.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outbox: Repository<OutboxEvent>,
    private readonly bus: AccessEventBusClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (
      !this.config.get<boolean>('eventBus.enabled') ||
      this.config.get<string>('eventBus.nodeEnv') === 'test'
    ) {
      return;
    }

    this.timer = setInterval(() => {
      void this.processPending().catch((error) =>
        this.logger.error(error instanceof Error ? error.message : error),
      );
    }, 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processPending(limit = 10) {
    const now = new Date();
    const events = await this.outbox.find({
      where: [
        { status: 'pending', nextAttemptAt: IsNull() },
        { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
        { status: 'failed', nextAttemptAt: LessThanOrEqual(now) },
        { status: 'publishing', nextAttemptAt: IsNull() },
        { status: 'publishing', nextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { occurredAt: 'ASC' },
      take: limit,
    });

    for (const event of events) await this.processEvent(event);
    return { processed: events.length };
  }

  private async processEvent(event: OutboxEvent) {
    const claimed = await this.outbox
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        status: 'publishing',
        nextAttemptAt: new Date(Date.now() + PUBLISH_LEASE_MS),
      })
      .where('id = :id', { id: event.id })
      .andWhere(
        "status IN ('pending', 'failed') OR (status = 'publishing' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))",
      )
      .execute();
    if (!claimed.affected) return;

    const payload = event.payload;
    const data = payload.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      await this.fail(event, new Error('Outbox event data is invalid'));
      return;
    }

    try {
      await this.bus.publish(event.eventType, data, {
        source: sourceValue(payload.source),
        correlationId: stringValue(payload.correlation_id),
        traceParent: stringValue(payload.trace_parent),
        subject: stringValue(payload.subject),
      });
      event.status = 'published';
      event.publishedAt = new Date();
      event.nextAttemptAt = null;
      event.lastError = null;
      await this.outbox.save(event);
      this.logger.log(`Published ${event.eventType} (${event.id})`);
    } catch (error) {
      await this.fail(event, error);
    }
  }

  private async fail(event: OutboxEvent, error: unknown) {
    event.attempts += 1;
    event.lastError = error instanceof Error ? error.message : String(error);
    const delay = RETRY_DELAYS_MS[event.attempts - 1];
    event.status = delay === undefined ? 'dead_letter' : 'failed';
    event.nextAttemptAt =
      delay === undefined ? null : new Date(Date.now() + delay);
    await this.outbox.save(event);
    if (delay === undefined) {
      this.logger.error(
        `Dead-lettered ${event.eventType} (${event.id}): ${event.lastError}`,
      );
    }
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sourceValue(value: unknown) {
  if (value === 'hemia-access') return 'urn:hemia:service:hemia-access';
  return stringValue(value);
}
