import { AccessContextCacheService } from '../../../../../apps/api/src/modules/access-context/cache/access-context-cache.service';
import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../../../../../apps/api/src/modules/audit/audit.service';
import { OutboxService } from '../../../../../apps/api/src/modules/outbox/outbox.service';
import { Organization } from '../../../../../apps/api/src/modules/organizations/entities/organization.entity';
import { OrganizationsService } from '../../../../../apps/api/src/modules/organizations/organizations.service';

describe('OrganizationsService', () => {
  const actor = {
    identityReferenceId: 'identity-id',
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType: 'workforce_user' as const,
  };

  it('maps unique violations to ACCESS_CONFLICT', async () => {
    const repository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockRejectedValue({ code: '23505' }),
    };
    const dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => unknown) =>
        callback({ getRepository: () => repository }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: AccessContextCacheService,
          useValue: { key: jest.fn(), del: jest.fn() },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Organization), useValue: repository },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: OutboxService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    const service = module.get(OrganizationsService);

    await expect(
      service.create(actor, {
        code: 'acme',
        slug: 'acme',
        name: 'ACME',
        type: 'customer',
      }),
    ).rejects.toMatchObject({
      code: 'ACCESS_CONFLICT',
      status: HttpStatus.CONFLICT,
    });
  });
});
