import { OutboxService } from '../../../../../apps/api/src/modules/outbox/outbox.service';

describe('OutboxService batches', () => {
  it('inserts bounded batches using the supplied transaction and preserves envelopes', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn((value: unknown) => value);
    const manager = { getRepository: () => ({ create, insert }) };
    const inputs = Array.from({ length: 1201 }, (_, id) => ({
      type: 'access.membership.context_invalidated.v1',
      aggregateType: 'membership',
      aggregateId: String(id),
      actor: {
        identityReferenceId: 'actor',
        issuer: 'issuer',
        subjectId: 'subject',
        identityType: 'workforce_user' as const,
      },
      data: { membership_id: String(id), context_version: 2 },
    }));
    await new OutboxService().recordMany(manager as never, inputs);
    expect(
      insert.mock.calls.map(([rows]) => (rows as unknown[]).length),
    ).toEqual([500, 500, 201]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        payload: expect.objectContaining({
          source: 'urn:hemia:service:hemia-access',
          data: inputs[0].data,
        }) as unknown,
      }),
    );
  });
});
