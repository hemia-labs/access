import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AuditEvent } from './entities/audit-event.entity';

type RecordAuditInput = {
  organizationId?: string | null;
  actor: AccessActor;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  record(manager: EntityManager, input: RecordAuditInput) {
    return manager.getRepository(AuditEvent).save(
      manager.getRepository(AuditEvent).create({
        organizationId: input.organizationId ?? null,
        actorType: 'identity',
        actorIssuer: input.actor.issuer,
        actorSubjectId: input.actor.subjectId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        beforeSnapshot: input.before ?? null,
        afterSnapshot: input.after ?? null,
        ipAddress: null,
        userAgent: null,
        correlationId: input.correlationId ?? null,
        metadata: input.metadata ?? {},
      }),
    );
  }
}
