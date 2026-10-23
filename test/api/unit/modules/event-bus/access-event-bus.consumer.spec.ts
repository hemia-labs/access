/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  LEGAL_RESULT_EVENT_BINDINGS,
  LEGAL_RESULT_EVENT_QUEUE,
} from '../../../../../apps/api/src/modules/event-bus/provisioning/access-event.contracts';
import { AccessEventBusConsumer } from '../../../../../apps/api/src/modules/event-bus/transport/access-event-bus.consumer';

describe('AccessEventBusConsumer', () => {
  it('subscribes to Legal provisioning results', async () => {
    const subscribe = jest.fn().mockResolvedValue(undefined);
    const bus = { connect: jest.fn().mockResolvedValue({ subscribe }) };
    const events = { consume: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'eventBus.enabled'
          ? true
          : key === 'eventBus.prefetch'
            ? 17
            : undefined,
      ),
    };
    const consumer = new AccessEventBusConsumer(
      bus as never,
      events as never,
      config as never,
    );

    await consumer.onModuleInit();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(
      {
        queue: LEGAL_RESULT_EVENT_QUEUE,
        bindings: [...LEGAL_RESULT_EVENT_BINDINGS],
      },
      expect.any(Function),
      expect.objectContaining({ prefetch: 17, validate: expect.any(Function) }),
    );
  });
});
