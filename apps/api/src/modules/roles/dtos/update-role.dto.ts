import { IsIn, IsOptional, IsString } from 'class-validator';
import type { CatalogStatus } from '../entities/permission.entity';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: CatalogStatus;
}
