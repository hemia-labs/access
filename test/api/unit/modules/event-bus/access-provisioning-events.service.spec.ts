/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { AccessProvisioningEventsService } from '../../../../../apps/api/src/modules/event-bus/provisioning/access-provisioning-events.service';

describe('AccessProvisioningEventsService', () => {
  it('updates Legal provisioning and records the next Access event', async () => {
    const organizationProduct = {
      id: 'org-product-1',
      organizationId: 'org-1',
      product: { code: 'legal' },
      organization: { name: 'Acme' },
      status: 'provisioning',
      version: 1,
      updatedByIdentityId: 'identity-1',
    };
    const instance = {
      organizationProductId: organizationProduct.id,
      externalTenantId: null,
      status: 'ready',
      metadata: {},
      lastVerifiedAt: null,
      provisionedAt: null,
    };
    const instanceRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn(() => instance),
      save: jest.fn(async (value) => value),
    };
    const productRepository = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(organizationProduct),
      })),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      createQueryBuilder: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest
          .fn()
          .mockResolvedValue({ identifiers: [{ id: 'inbox-1' }] }),
      })),
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity.name === 'OrganizationProduct') return productRepository;
        if (entity.name === 'OrganizationProductInstance')
          return instanceRepository;
        return { find: jest.fn().mockResolvedValue([]) };
      }),
    };
    const transaction = jest.fn(async (callback) => callback(manager));
    const audit = { record: jest.fn() };
    const outbox = { record: jest.fn() };
    const cache = { key: jest.fn((value) => value), del: jest.fn() };
    const service = new AccessProvisioningEventsService(
      { transaction } as never,
      audit as never,
      outbox as never,
      cache as never,
    );

    await service.consume({
      specVersion: '1.0',
      id: 'event-1',
      type: 'product.organization_product.provisioned.v1',
      source: 'urn:hemia:service:hemia-legal',
      time: new Date().toISOString(),
      dataContentType: 'application/json',
      correlationId: 'corr-1',
      data: {
        organization_id: 'org-1',
        product_code: 'legal',
        external_tenant_id: 'tenant-1',
        provisioning_status: 'ready',
        tenant_status: 'provisioning',
        tenant_version: 1,
      },
    });

    expect(instance.externalTenantId).toBe('tenant-1');
    expect(organizationProduct.status).toBe('enabled');
    expect(outbox.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        type: 'access.organization_product.enabled.v1',
      }),
    );
  });

  it('does not mutate Access for another product', async () => {
    const transaction = jest.fn();
    const service = new AccessProvisioningEventsService(
      { transaction } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.consume({
      specVersion: '1.0',
      id: 'event-2',
      type: 'product.organization_product.provisioned.v1',
      source: 'urn:hemia:service:other',
      time: new Date().toISOString(),
      dataContentType: 'application/json',
      correlationId: 'corr-2',
      data: {
        organization_id: 'org-1',
        product_code: 'docs',
        external_tenant_id: 'tenant-1',
        provisioning_status: 'ready',
      },
    });

    expect(transaction).not.toHaveBeenCalled();
  });
});
