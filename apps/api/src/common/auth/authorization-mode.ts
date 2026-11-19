/** Validate legacy mode settings at startup; authorization always requires roles. */
export function authorizationMode(productCode?: 'billing' | 'legal'): 'roles' {
  const variable =
    productCode === 'billing' && process.env.HEMIA_BILLING_AUTHORIZATION_MODE
      ? 'HEMIA_BILLING_AUTHORIZATION_MODE'
      : 'HEMIA_AUTHORIZATION_MODE';
  const mode = process.env[variable] || 'roles';
  if (mode !== 'roles')
    throw new Error(
      `Invalid ${variable}: only roles is supported; authenticated authorization has been removed`,
    );
  return mode;
}
