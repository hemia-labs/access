import { AccessEventOutboxPublisher } from './access-event-outbox.publisher';

describe('AccessEventOutboxPublisher', () => {
  it('publishes only the domain data and preserves envelope options', async () => {
    const event = {
      id: 'outbox-1',
      eventType: 'access.organization_product.enable_requested.v1',
      payload: {
        source: 'urn:hemia:service:hemia-access',
        correlation_id: 'corr-1',
        trace_parent: '00-trace',
        subject: 'organizations/org-1/products/legal',
        data: { organization_id: 'org-1', product_code: 'legal' },
      },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      occurredAt: new Date(),
      publishedAt: null,
      lastError: null,
    };
    const save = jest.fn((value: typeof event) => Promise.resolve(value));
    const repository = {
      find: jest.fn().mockResolvedValue([event]),
      save,
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string) =>
        key === 'eventBus.enabled'
          ? true
          : key === 'eventBus.nodeEnv'
            ? 'test'
            : undefined,
      ),
    };
    const publisher = new AccessEventOutboxPublisher(
      repository as never,
      bus as never,
      config as never,
    );

    await publisher.processPending();

    expect(bus.publish).toHaveBeenCalledWith(
      event.eventType,
      event.payload.data,
      expect.objectContaining({
        source: event.payload.source,
        correlationId: 'corr-1',
        traceParent: '00-trace',
        subject: event.payload.subject,
      }),
    );
    expect(event.status).toBe('published');
    expect(save).toHaveBeenCalled();
  });
});
