import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ResolveContextDto {
  @IsUUID()
  organization_id: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  product_code?: string;
}
