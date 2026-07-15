import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
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
};

@Injectable()
export class OutboxService {
  record(manager: EntityManager, input: RecordEventInput) {
    return manager.getRepository(OutboxEvent).save(
      manager.getRepository(OutboxEvent).create({
        eventType: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        status: 'pending',
        payload: {
          type: input.type,
          source: 'hemia-access',
          occurred_at: new Date().toISOString(),
          correlation_id: input.correlationId ?? null,
          causation_id: input.causationId ?? null,
          actor: {
            type: 'identity',
            issuer: input.actor.issuer,
            subject_id: input.actor.subjectId,
          },
          data: input.data,
        },
      }),
    );
  }
}
