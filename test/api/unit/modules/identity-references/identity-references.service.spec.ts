import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IdentityReference,
  IdentityType,
} from '../../../../../apps/api/src/modules/identity-references/entities/identity-reference.entity';
import { IdentityReferencesService } from '../../../../../apps/api/src/modules/identity-references/identity-references.service';

describe('IdentityReferencesService', () => {
  it('reuses an existing identity reference', async () => {
    const existing = {
      id: 'identity-id',
      issuer: 'http://localhost:4000',
      subjectId: 'user-id',
      identityType: 'workforce_user',
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneByOrFail: jest
        .fn()
        .mockResolvedValue({ ...existing, status: 'disabled' }),
    };
    const module = await Test.createTestingModule({
      providers: [
        IdentityReferencesService,
        {
          provide: getRepositoryToken(IdentityReference),
          useValue: repository,
        },
      ],
    }).compile();

    const service = module.get(IdentityReferencesService);
    const result = await service.findOrCreateFromClaims({
      issuer: 'http://localhost:4000',
      subjectId: 'user-id',
      identityType: 'workforce_user',
      email: 'admin@hemia.local',
      displayName: 'Admin',
      avatarUrl: null,
    });

    expect(result.id).toBe('identity-id');
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      { id: existing.id, identityType: 'workforce_user' },
      {
        emailSnapshot: 'admin@hemia.local',
        displayNameSnapshot: 'Admin',
        avatarUrlSnapshot: null,
        lastSyncedAt: expect.any(Date) as Date,
      },
    );
    expect(result).toMatchObject({ status: 'disabled' });
  });

  it.each([
    ['workforce_user', 'service_account'],
    ['service_account', 'workforce_user'],
  ] as const)(
    'rejects an existing %s identity presented as %s',
    async (stored, incoming) => {
      const { service, repository } = createService(stored);

      await expect(
        service.findOrCreateFromClaims(claims(incoming)),
      ).rejects.toMatchObject({
        code: 'ACCESS_IDENTITY_TYPE_MISMATCH',
        status: 401,
      });
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'validates identity type after a concurrent insert: %s',
    async (matches) => {
      const { service, repository } = createService(null);
      repository.save.mockRejectedValue({ code: '23505' });
      repository.findOneByOrFail.mockResolvedValue({
        id: 'concurrent-reference',
        issuer: 'http://localhost:4000',
        subjectId: 'user-id',
        identityType: matches ? 'service_account' : 'workforce_user',
      });

      const operation = service.findOrCreateFromClaims(
        claims('service_account'),
      );
      if (matches) {
        await expect(operation).resolves.toMatchObject({
          id: 'concurrent-reference',
          identityType: 'service_account',
        });
      } else {
        await expect(operation).rejects.toMatchObject({
          code: 'ACCESS_IDENTITY_TYPE_MISMATCH',
          status: 401,
        });
      }
    },
  );

  it('persists a new service identity', async () => {
    const { service, repository } = createService(null);

    await expect(
      service.findOrCreateFromClaims(claims('service_account')),
    ).resolves.toMatchObject({
      identityType: 'service_account',
      status: 'active',
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  const claims = (identityType: IdentityType) => ({
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType,
    email: null,
    displayName: null,
    avatarUrl: null,
  });

  const createService = (existingType: IdentityType | null) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(
        existingType === null
          ? null
          : {
              id: 'existing-reference',
              identityType: existingType,
            },
      ),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      findOneByOrFail: jest.fn(),
    };
    return {
      repository,
      service: new IdentityReferencesService(
        repository as unknown as Repository<IdentityReference>,
      ),
    };
  };
});
