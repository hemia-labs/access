// Administrative projection. Permission meanings remain in Legal.
export const legalRoleCatalog = {
  product_code: 'legal',
  scope_profile: 'legal_v1',
  contract_version: 1,
  catalog_version: 1,
  roles: [
    {
      code: 'legal.viewer',
      name: 'viewer',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'not_applicable',
        },
      ],
    },
    {
      code: 'legal.editor',
      name: 'editor',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'not_applicable',
        },
      ],
    },
    {
      code: 'legal.publisher',
      name: 'publisher',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'not_applicable',
        },
      ],
    },
    {
      code: 'legal.catalog_manager',
      name: 'catalog_manager',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'not_applicable',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'not_applicable',
        },
      ],
    },
    {
      code: 'legal.auditor',
      name: 'auditor',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'organizations',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'organizations',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'organizations',
        },
      ],
    },
    {
      code: 'legal.notification_operator',
      name: 'notification_operator',
      allowed_scopes: [
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'legal_global',
          consumer_scope_type: 'organizations',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'issuers',
          consumer_scope_type: 'organizations',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'all_organizations',
        },
        {
          scope_type: 'applications',
          consumer_scope_type: 'organizations',
        },
      ],
    },
  ],
} as const;

export const legalRoleCatalogV2 = {
  ...legalRoleCatalog,
  catalog_version: 2,
  roles: [
    ...legalRoleCatalog.roles,
    {
      code: 'legal.integration_manager',
      name: 'integration_manager',
      allowed_scopes: [
        { scope_type: 'issuers', consumer_scope_type: 'not_applicable' },
        { scope_type: 'applications', consumer_scope_type: 'not_applicable' },
      ],
    },
  ],
} as const;
