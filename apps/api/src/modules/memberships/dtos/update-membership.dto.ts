import { IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import type { MembershipType } from '../entities/membership.entity';

export class UpdateMembershipDto {
  @IsOptional()
  @IsIn(['member', 'owner', 'external_collaborator', 'service'])
  membership_type?: MembershipType;

  @IsOptional()
  @IsString()
  expires_at?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  version?: number;
}
