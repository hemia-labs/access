import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { ProductAudience, ProductProvisioningMode, ProductStatus } from '../entities/product.entity';
import type { OrganizationProductSource } from '../entities/organization-product.entity';
import type { ProductInstanceStatus } from '../entities/organization-product-instance.entity';

export class CreateProductDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['internal', 'customer', 'mixed'])
  audience?: ProductAudience;

  @IsOptional()
  @IsIn(['manual', 'event_driven', 'api_callback', 'none'])
  provisioning_mode?: ProductProvisioningMode;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['internal', 'customer', 'mixed'])
  audience?: ProductAudience;

  @IsOptional()
  @IsIn(['manual', 'event_driven', 'api_callback', 'none'])
  provisioning_mode?: ProductProvisioningMode;

  @IsOptional()
  @IsIn(['active', 'deprecated', 'disabled'])
  status?: ProductStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class EnableProductDto {
  @IsOptional()
  @IsIn(['manual', 'billing', 'contract', 'migration', 'internal'])
  source?: OrganizationProductSource;

  @IsOptional()
  @IsString()
  entitlement_reference?: string;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class ProductInstanceDto {
  @IsString()
  organization_id: string;

  @IsString()
  product_code: string;

  @IsOptional()
  @IsString()
  external_tenant_id?: string;

  @IsIn(['ready', 'failed'])
  status: ProductInstanceStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
