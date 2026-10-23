import { PermanentError } from '@hemia/event-bus';

export const LEGAL_ACCESS_EVENT_TYPES = [
  'access.organization.eligibility_changed.v1',
  'access.membership.context_invalidated.v1',
  'access.organization_product.enable_requested.v1',
  'access.organization_product.provisioning.v1',
  'access.organization_product.enabled.v1',
  'access.organization_product.suspended.v1',
  'access.organization_product.disabled.v1',
  'access.organization_product.failed.v1',
  'access.organization.suspended.v1',
  'access.organization.archived.v1',
  'access.membership.suspended.v1',
  'access.membership.revoked.v1',
  'access.membership.role_assigned.v1',
  'access.membership.role_revoked.v1',
] as const;

export const LEGAL_RESULT_EVENT_TYPES = [
  'product.organization_product.provisioned.v1',
  'product.organization_product.provisioning_failed.v1',
] as const;

export const LEGAL_RESULT_EVENT_QUEUE = 'hemia-access.legal';
export const LEGAL_RESULT_EVENT_BINDINGS = [
  ...LEGAL_RESULT_EVENT_TYPES,
] as const;

export type LegalProductAccessEvent = {
  organization_id: string;
  product_code: string;
  organization_name?: string;
  status?:
    | 'pending'
    | 'provisioning'
    | 'enabled'
    | 'suspended'
    | 'disabled'
    | 'failed'
    | 'expired';
  provisioning_status?: 'pending' | 'ready' | 'failed';
  external_tenant_id?: string;
  context_version?: number;
};

export type LegalMembershipEvent = {
  organization_id: string;
  identity_issuer: string;
  subject_id: string;
  membership_status?: 'active' | 'suspended' | 'revoked';
  role_codes?: string[];
  context_version?: number;
};

export type LegalProvisioningResult = {
  organization_id: string;
  product_code: string;
  external_tenant_id?: string;
  provisioning_status: 'ready' | 'failed';
  tenant_status?: string;
  tenant_version?: number;
  failure_code?: string;
  failure_reason?: string;
};

export function validateLegalProvisioningResult(
  type: string,
  value: unknown,
): LegalProvisioningResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PermanentError(`Invalid payload for ${type}`);
  }

  const data = value as Record<string, unknown>;
  requireString(data, 'organization_id', type);
  requireString(data, 'product_code', type);
  if (
    data.provisioning_status !== 'ready' &&
    data.provisioning_status !== 'failed'
  ) {
    throw new PermanentError(`${type} requires a valid provisioning_status`);
  }
  if (data.provisioning_status === 'ready') {
    requireString(data, 'external_tenant_id', type);
  }
  if (
    data.tenant_version !== undefined &&
    typeof data.tenant_version !== 'number'
  ) {
    throw new PermanentError(`${type} has invalid tenant_version`);
  }

  return data as unknown as LegalProvisioningResult;
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  type: string,
): asserts value is Record<string, unknown> & Record<typeof field, string> {
  if (typeof value[field] !== 'string' || value[field].length === 0) {
    throw new PermanentError(`${type} requires ${field}`);
  }
}
