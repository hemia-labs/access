export type BillingResourceScope =
  'catalog_global' | 'all_customers' | 'organizations';
export type LegalResourceScope = 'legal_global' | 'issuers' | 'applications';
export type SystemResourceScope = BillingResourceScope | LegalResourceScope;
export type SystemScopeProfile = 'billing_v1' | 'legal_v1';
export type SystemConsumerScope =
  'not_applicable' | 'all_organizations' | 'organizations';
export type SystemTargetType =
  'organization' | 'legal_issuer' | 'legal_application';
