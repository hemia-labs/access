import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async findOrCreateFromClaims(input: ClaimsInput) {
    const existing = await this.repository.findOne({
      where: { issuer: input.issuer, subjectId: input.subjectId },
    });

    if (existing) {
      existing.emailSnapshot = input.email;
      existing.displayNameSnapshot = input.displayName;
      existing.avatarUrlSnapshot = input.avatarUrl;
      existing.lastSyncedAt = new Date();
      return this.repository.save(existing);
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
        return this.repository.findOneByOrFail({
          issuer: input.issuer,
          subjectId: input.subjectId,
        });
      }
      throw error;
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
