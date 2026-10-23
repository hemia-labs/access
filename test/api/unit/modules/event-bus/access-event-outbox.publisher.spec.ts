import { AccessEventOutboxPublisher } from '../../../../../apps/api/src/modules/event-bus/access-event-outbox.publisher';

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
        eventId: event.id,
        occurredAt: event.occurredAt.toISOString(),
        source: event.payload.source,
        correlationId: 'corr-1',
        traceParent: '00-trace',
        subject: event.payload.subject,
      }),
    );
    expect(event.status).toBe('published');
    expect(save).toHaveBeenCalled();
  });
  it('does not overlap workers and preserves retry backoff on broker failure', async () => {
    let rejectPublish!: (error: Error) => void;
    const publish = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPublish = reject;
        }),
    );
    const event = {
      id: 'outbox-2',
      eventType: 'access.membership.context_invalidated.v1',
      payload: { data: { membership_id: 'member' } },
      occurredAt: new Date(),
      attempts: 0,
      status: 'pending',
      nextAttemptAt: null as Date | null,
    };
    const condition = jest.fn().mockReturnThis();
    const repository = {
      find: jest.fn().mockResolvedValue([event]),
      save: jest.fn().mockResolvedValue(event),
      createQueryBuilder: () => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: condition,
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    };
    const publisher = new AccessEventOutboxPublisher(
      repository as never,
      { publish } as never,
      {} as never,
    );
    const first = publisher.processPending();
    while (!rejectPublish) await Promise.resolve();
    expect(await publisher.processPending()).toEqual({ processed: 0 });
    expect(repository.find).toHaveBeenCalledTimes(1);
    const now = Date.now();
    rejectPublish(new Error('broker unavailable'));
    await first;
    expect(event.status).toBe('failed');
    expect(event.attempts).toBe(1);
    expect(event.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(now + 10_000);
    expect(condition).toHaveBeenCalledWith(
      expect.stringContaining('next_attempt_at <= NOW()'),
    );
    repository.find.mockResolvedValue([]);
    expect(await publisher.processPending()).toEqual({ processed: 0 });
    expect(repository.find).toHaveBeenCalledTimes(2);
  });
});
