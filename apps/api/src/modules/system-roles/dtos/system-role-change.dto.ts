import { BILLING_MAX_TARGET_REFERENCES } from '../authorization/billing-authorization-limits';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import type { BillingResourceScope } from '../authorization/system-resource-scope';
export class RevokeSystemRoleDto {
  @IsInt() @Min(1) expectedVersion: number;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  authorityDelegationId?: string;
}
export class ReplaceSystemRoleDto extends RevokeSystemRoleDto {
  @IsUUID() idempotencyKey: string;
  @IsUUID() roleId: string;
  @IsIn(['catalog_global', 'all_customers', 'organizations'])
  scopeType: BillingResourceScope;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(BILLING_MAX_TARGET_REFERENCES)
  @IsUUID('all', { each: true })
  organizationIds: string[];
  @IsISO8601({ strict: true }) validFrom: string;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  expiresAt: string | null;
}
export class ReplaceSystemRoleDelegationDto extends ReplaceSystemRoleDto {
  @IsUUID() recipientOrganizationId: string;
  @IsBoolean() canGrant: boolean;
  @IsBoolean() canRevoke: boolean;
}

export class CreateSystemRoleDto {
  @IsUUID() membershipId: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  authorityDelegationId?: string;
  @IsUUID() idempotencyKey: string;
  @IsUUID() roleId: string;
  @IsIn(['catalog_global', 'all_customers', 'organizations'])
  scopeType: BillingResourceScope;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(BILLING_MAX_TARGET_REFERENCES)
  @IsUUID('all', { each: true })
  organizationIds: string[];
  @IsISO8601({ strict: true }) validFrom: string;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  expiresAt: string | null;
}
export class CreateSystemRoleDelegationDto extends CreateSystemRoleDto {
  @IsUUID() recipientOrganizationId: string;
  @IsBoolean() canGrant: boolean;
  @IsBoolean() canRevoke: boolean;
}
