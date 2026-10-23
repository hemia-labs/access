import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AccessActor } from '../../common/auth/access-actor.type';
import { OutboxEvent } from './entities/outbox-event.entity';

type RecordEventInput = {
  type: string;
  aggregateType: string;
  aggregateId: string;
  actor: AccessActor;
  data: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  traceParent?: string | null;
  subject?: string | null;
};

@Injectable()
export class OutboxService {
  record(manager: EntityManager, input: RecordEventInput) {
    return manager.getRepository(OutboxEvent).save(this.event(manager, input));
  }

  async recordMany(manager: EntityManager, inputs: RecordEventInput[]) {
    // Bound statement size while keeping every chunk in the caller's transaction.
    for (let offset = 0; offset < inputs.length; offset += 500) {
      await manager.getRepository(OutboxEvent).insert(
        // TypeORM's recursive partial type cannot represent opaque JSONB values.
        inputs
          .slice(offset, offset + 500)
          .map((input) =>
            this.event(manager, input),
          ) as QueryDeepPartialEntity<OutboxEvent>[],
      );
    }
  }

  private event(manager: EntityManager, input: RecordEventInput) {
    return manager.getRepository(OutboxEvent).create({
      eventType: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      status: 'pending',
      payload: {
        type: input.type,
        source: 'urn:hemia:service:hemia-access',
        occurred_at: new Date().toISOString(),
        correlation_id: input.correlationId ?? null,
        causation_id: input.causationId ?? null,
        trace_parent: input.traceParent ?? null,
        subject: input.subject ?? null,
        actor: {
          type: 'identity',
          issuer: input.actor.issuer,
          subject_id: input.actor.subjectId,
        },
        data: input.data,
      },
    });
  }
}
