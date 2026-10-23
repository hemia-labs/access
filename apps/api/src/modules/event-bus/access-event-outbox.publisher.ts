import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AccessEventBusClient } from './transport/access-event-bus.client';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';

const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];
const PUBLISH_LEASE_MS = 30_000;

@Injectable()
export class AccessEventOutboxPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccessEventOutboxPublisher.name);
  private stopped = false;
  private processing = false;
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

    this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private async tick() {
    let delay = 5_000;
    try {
      const result = await this.processPending();
      // Drain a backlog without a five-second pause between full batches.
      if (result.processed === 100) delay = 0;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : error);
    } finally {
      this.schedule(delay);
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async processPending(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError('Outbox limit must be 1..1000');
    if (this.processing) return { processed: 0 };
    this.processing = true;
    const started = Date.now();
    try {
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

      const lags: number[] = [];
      for (const event of events) {
        const lag = await this.processEvent(event);
        if (lag !== undefined) lags.push(lag);
      }
      if (events.length) {
        lags.sort((a, b) => a - b);
        this.logger.log(
          JSON.stringify({
            metric: 'access_outbox_batch',
            selected: events.length,
            published: lags.length,
            duration_ms: Date.now() - started,
            oldest_selected_age_ms: Math.max(
              0,
              started - events[0].occurredAt.getTime(),
            ),
            publication_lag_p95_ms:
              lags[Math.ceil(lags.length * 0.95) - 1] ?? null,
            publication_lag_p99_ms:
              lags[Math.ceil(lags.length * 0.99) - 1] ?? null,
          }),
        );
      }
      return { processed: events.length };
    } finally {
      this.processing = false;
    }
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
        "status IN ('pending', 'failed', 'publishing') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())",
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
        eventId: event.id,
        occurredAt: event.occurredAt.toISOString(),
        source: sourceValue(payload.source),
        correlationId: stringValue(payload.correlation_id) ?? event.id,
        traceParent: stringValue(payload.trace_parent),
        subject: stringValue(payload.subject),
      });
      event.status = 'published';
      event.publishedAt = new Date();
      event.nextAttemptAt = null;
      event.lastError = null;
      await this.outbox.save(event);
      return Math.max(
        0,
        event.publishedAt.getTime() - event.occurredAt.getTime(),
      );
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
