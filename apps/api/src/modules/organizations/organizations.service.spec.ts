import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { Organization } from './entities/organization.entity';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  const actor = {
    identityReferenceId: 'identity-id',
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType: 'workforce_user' as const,
  };

  it('maps unique violations to ACCESS_CONFLICT', async () => {
    const repository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockRejectedValue({ code: '23505' }),
    };
    const dataSource = {
      transaction: jest.fn((callback) =>
        callback({ getRepository: () => repository }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
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
