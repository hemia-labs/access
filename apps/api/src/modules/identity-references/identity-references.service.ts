import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessError } from '../../common/errors/access-error';
import {
  IdentityReference,
  IdentityType,
} from './entities/identity-reference.entity';

type ClaimsInput = {
  issuer: string;
  subjectId: string;
  identityType: IdentityType;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

@Injectable()
export class IdentityReferencesService {
  constructor(
    @InjectRepository(IdentityReference)
    private readonly repository: Repository<IdentityReference>,
  ) {}

  async findActiveById(id: string) {
    const identity = await this.repository.findOneBy({ id, status: 'active' });
    if (!identity)
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Identity is not active',
        HttpStatus.FORBIDDEN,
      );
    return identity;
  }

  async findOrCreateFromClaims(input: ClaimsInput) {
    const existing = await this.repository.findOne({
      where: { issuer: input.issuer, subjectId: input.subjectId },
    });

    if (existing) {
      this.assertIdentityType(existing, input.identityType);
      // A stale metadata refresh must never restore status or rewrite the identity type.
      await this.repository.update(
        { id: existing.id, identityType: input.identityType },
        {
          emailSnapshot: input.email,
          displayNameSnapshot: input.displayName,
          avatarUrlSnapshot: input.avatarUrl,
          lastSyncedAt: new Date(),
        },
      );
      const current = await this.repository.findOneByOrFail({
        id: existing.id,
      });
      this.assertIdentityType(current, input.identityType);
      return current;
    }

    try {
      return await this.repository.save(
        this.repository.create({
          issuer: input.issuer,
          subjectId: input.subjectId,
          identityType: input.identityType,
          emailSnapshot: input.email,
          displayNameSnapshot: input.displayName,
          avatarUrlSnapshot: input.avatarUrl,
          status: 'active',
          lastSyncedAt: new Date(),
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const identity = await this.repository.findOneByOrFail({
          issuer: input.issuer,
          subjectId: input.subjectId,
        });
        this.assertIdentityType(identity, input.identityType);
        return identity;
      }
      throw error;
    }
  }

  private assertIdentityType(
    identity: IdentityReference,
    expected: IdentityType,
  ) {
    if (identity.identityType !== expected) {
      throw new AccessError(
        'ACCESS_IDENTITY_TYPE_MISMATCH',
        'Identity reference type does not match the verified identity',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
