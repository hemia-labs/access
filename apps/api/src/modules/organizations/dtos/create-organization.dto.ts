import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  OrganizationStatus,
  OrganizationType,
} from '../entities/organization.entity';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  legalName?: string;

  @IsIn(['internal', 'customer', 'partner', 'vendor', 'sandbox'])
  type: OrganizationType;

  @IsOptional()
  @IsIn(['pending', 'active', 'suspended', 'archived'])
  status?: OrganizationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
