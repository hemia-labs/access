import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsUUID,
  Matches,
  Min,
  ValidateBy,
  ValidateIf,
  ValidationArguments,
} from 'class-validator';
import type {
  LegalResourceScope,
  SystemConsumerScope,
} from '../authorization/system-resource-scope';

const normalizeIds = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((id: unknown) =>
        typeof id === 'string' ? id.toLowerCase() : id,
      )
    : value;

function validDimensions(_: unknown, args?: ValidationArguments): boolean {
  const value = args?.object as LegalSystemRoleDto;
  return (
    Array.isArray(value.resourceIds) &&
    Array.isArray(value.organizationIds) &&
    value.resourceIds.length + value.organizationIds.length <= 1000 &&
    (value.scopeType === 'legal_global'
      ? value.resourceIds.length === 0
      : value.resourceIds.length > 0) &&
    (value.consumerScopeType === 'organizations'
      ? value.organizationIds.length > 0
      : value.organizationIds.length === 0) &&
    (value.expiresAt === null ||
      new Date(value.expiresAt) > new Date(value.validFrom))
  );
}
function explicitDelegation(_: unknown, args?: ValidationArguments): boolean {
  const value = args?.object as LegalSystemRoleDto & {
    canGrant: boolean;
    canRevoke: boolean;
  };
  return (
    value.authorityDelegationId === undefined &&
    (value.canGrant || value.canRevoke) &&
    ['issuers', 'applications'].includes(value.scopeType) &&
    ['not_applicable', 'organizations'].includes(value.consumerScopeType)
  );
}

/** Legal request contract selected by resource scope; role/profile is verified in the transaction. */
class LegalSystemRoleDto {
  @IsUUID() idempotencyKey: string;
  @IsUUID() roleId: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  authorityDelegationId?: string;

  @IsIn(['legal_global', 'issuers', 'applications'])
  scopeType: LegalResourceScope;

  @IsIn(['not_applicable', 'all_organizations', 'organizations'])
  consumerScopeType: SystemConsumerScope;

  @Transform(normalizeIds)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  @ValidateBy({
    name: 'legalScopeDimensions',
    validator: {
      validate: validDimensions,
      defaultMessage: () =>
        'Legal targets must match both dimensions, total at most 1000, and a valid interval',
    },
  })
  resourceIds: string[];

  @Transform(normalizeIds)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  organizationIds: string[];

  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]00:00)$/)
  validFrom: string;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]00:00)$/)
  expiresAt: string | null;
}
export class CreateLegalSystemRoleDto extends LegalSystemRoleDto {
  @IsUUID() membershipId: string;
}
export class ReplaceLegalSystemRoleDto extends LegalSystemRoleDto {
  @IsInt() @Min(1) expectedVersion: number;
}
export class CreateLegalSystemRoleDelegationDto extends CreateLegalSystemRoleDto {
  @IsUUID() recipientOrganizationId: string;
  @IsBoolean()
  @ValidateBy({
    name: 'explicitLegalDelegation',
    validator: { validate: explicitDelegation },
  })
  canGrant: boolean;
  @IsBoolean() canRevoke: boolean;
}
export class ReplaceLegalSystemRoleDelegationDto extends ReplaceLegalSystemRoleDto {
  @IsUUID() recipientOrganizationId: string;
  @IsBoolean()
  @ValidateBy({
    name: 'explicitLegalDelegation',
    validator: { validate: explicitDelegation },
  })
  canGrant: boolean;
  @IsBoolean() canRevoke: boolean;
}
