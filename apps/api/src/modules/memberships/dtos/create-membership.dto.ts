import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { MembershipType } from '../entities/membership.entity';

class MembershipIdentityDto {
  @IsString()
  @IsNotEmpty()
  issuer: string;

  @IsString()
  @IsNotEmpty()
  subject_id: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateMembershipDto {
  @IsObject()
  identity: MembershipIdentityDto;

  @IsOptional()
  @IsIn(['member', 'owner', 'external_collaborator', 'service'])
  membership_type?: MembershipType;

  @IsOptional()
  @IsArray()
  role_codes?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
