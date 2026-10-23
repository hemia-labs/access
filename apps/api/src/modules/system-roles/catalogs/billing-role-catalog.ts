// Publication artifact projected from Billing billing-authorization-v1.json.
// Permissions remain exclusively in Billing. Changes require a new catalog version.
export const billingRoleCatalog = {
  product_code: 'billing',
  contract_version: 1,
  catalog_version: 1,
  roles: [
    {
      code: 'billing.viewer',
      name: 'Consulta operativa',
      allowed_scopes: ['all_customers', 'organizations'],
    },
    {
      code: 'billing.operator',
      name: 'Operación de compras y extras',
      allowed_scopes: ['all_customers', 'organizations'],
    },
    {
      code: 'billing.catalog_manager',
      name: 'Administración de catálogo',
      allowed_scopes: ['catalog_global'],
    },
    {
      code: 'billing.invoice_operator',
      name: 'Operación de facturas',
      allowed_scopes: ['all_customers', 'organizations'],
    },
    {
      code: 'billing.auditor',
      name: 'Auditoría',
      allowed_scopes: ['all_customers', 'organizations'],
    },
    {
      code: 'billing.integration_operator',
      name: 'Operación de integraciones',
      allowed_scopes: ['all_customers', 'organizations'],
    },
  ],
} as const;
