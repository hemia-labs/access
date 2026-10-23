import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsDateString,
} from 'class-validator';
import type { MembershipType } from '../entities/membership.entity';

export class UpdateMembershipDto {
  @IsOptional()
  @IsIn(['member', 'owner', 'external_collaborator', 'service'])
  membership_type?: MembershipType;

  @IsOptional()
  @IsDateString()
  expires_at?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  version?: number;
}
