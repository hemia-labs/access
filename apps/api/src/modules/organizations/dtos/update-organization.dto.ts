import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { OrganizationType } from '../entities/organization.entity';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  legalName?: string;

  @IsOptional()
  @IsIn(['internal', 'customer', 'partner', 'vendor', 'sandbox'])
  type?: OrganizationType;

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
