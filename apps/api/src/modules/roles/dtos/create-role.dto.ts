import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { AccessScope } from '../entities/permission.entity';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['organization'])
  scope?: AccessScope;
}
