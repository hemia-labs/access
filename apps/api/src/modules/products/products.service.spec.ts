import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationProduct } from './entities/organization-product.entity';
import { OrganizationProductInstance } from './entities/organization-product-instance.entity';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

describe('ProductsService event emission', () => {
  it('emits enable_requested and provisioning for event-driven enablement', async () => {
    const organization = { id: 'org-1', name: 'Acme' };
    const product = {
      id: 'product-1',
      code: 'legal',
      status: 'active',
      provisioningMode: 'event_driven',
    };
    const organizationProduct = {
      id: 'org-product-1',
      organizationId: organization.id,
      productId: product.id,
      status: 'pending',
      version: 1,
      configuration: {},
    };
    const organizationRepository = {
      findOneBy: jest.fn().mockResolvedValue(organization),
    };
    const productRepository = {
      findOneBy: jest.fn().mockResolvedValue(product),
    };
    const organizationProductRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ ...organizationProduct, ...value })),
      save: jest.fn(async (value) => value),
    };
    const instanceRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const membershipRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Organization) return organizationRepository;
        if (entity === Product) return productRepository;
        if (entity === OrganizationProduct)
          return organizationProductRepository;
        if (entity === OrganizationProductInstance) return instanceRepository;
        if (entity === Membership) return membershipRepository;
        throw new Error('Unexpected repository');
      }),
    };
    const outbox = { record: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new ProductsService(
      dataSource as never,
      {} as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      outbox as never,
      { key: jest.fn((value) => value), del: jest.fn() } as never,
    );

    await service.enable(
      {
        identityReferenceId: 'identity-1',
        issuer: 'urn:hemia:service:console',
        subjectId: 'console',
        identityType: 'service_account',
      },
      organization.id,
      product.code,
      { source: 'manual' },
    );

    const calls = outbox.record.mock.calls as Array<
      [
        unknown,
        { type: string; data: { status: string; provisioning_status: string } },
      ]
    >;
    expect(calls.map(([, event]) => event.type)).toEqual([
      'access.organization_product.enable_requested.v1',
      'access.organization_product.provisioning.v1',
    ]);
    expect(calls[1][1].data).toMatchObject({
      status: 'provisioning',
      provisioning_status: 'pending',
    });
  });
});
