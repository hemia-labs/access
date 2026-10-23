import { PermanentError } from '@hemia/event-bus';
import { validateLegalProvisioningResult } from '../../../../../apps/api/src/modules/event-bus/provisioning/access-event.contracts';

describe('Access Event Bus contracts', () => {
  it('requires an external tenant for a ready provisioning result', () => {
    expect(() =>
      validateLegalProvisioningResult(
        'product.organization_product.provisioned.v1',
        {
          organization_id: 'org-1',
          product_code: 'legal',
          provisioning_status: 'ready',
        },
      ),
    ).toThrow(PermanentError);
  });

  it('accepts a safe failed provisioning result', () => {
    expect(
      validateLegalProvisioningResult(
        'product.organization_product.provisioning_failed.v1',
        {
          organization_id: 'org-1',
          product_code: 'legal',
          provisioning_status: 'failed',
          failure_code: 'DATABASE_UNAVAILABLE',
          failure_reason: 'Database unavailable',
        },
      ),
    ).toMatchObject({ provisioning_status: 'failed' });
  });
});
