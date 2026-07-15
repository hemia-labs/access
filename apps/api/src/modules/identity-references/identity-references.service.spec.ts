import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdentityReference } from './entities/identity-reference.entity';
import { IdentityReferencesService } from './identity-references.service';

describe('IdentityReferencesService', () => {
  it('reuses an existing identity reference', async () => {
    const existing = {
      id: 'identity-id',
      issuer: 'http://localhost:4000',
      subjectId: 'user-id',
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => value),
    };
    const module = await Test.createTestingModule({
      providers: [
        IdentityReferencesService,
        { provide: getRepositoryToken(IdentityReference), useValue: repository },
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
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
