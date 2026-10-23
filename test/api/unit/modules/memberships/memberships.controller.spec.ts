import { MembershipsController } from '../../../../../apps/api/src/modules/memberships/memberships.controller';

describe('MembershipsController suspension', () => {
  const actor = { identityReferenceId: 'actor' };

  it('delegates suspension to the normal membership transaction', async () => {
    const memberships = {
      setStatus: jest.fn().mockResolvedValue({ status: 'suspended' }),
    };
    const controller = new MembershipsController(memberships as never);
    await expect(
      controller.suspend({ accessActor: actor }, 'org', 'member', {}),
    ).resolves.toEqual({ status: 'suspended' });
    expect(memberships.setStatus).toHaveBeenCalledWith(
      actor,
      'org',
      'member',
      'suspended',
    );
  });

  it.each([{ actor: 'forged' }, { roles: ['admin'] }, [], null, 'invalid'])(
    'rejects client-supplied suspension fields: %p',
    (body) => {
      const memberships = { setStatus: jest.fn() };
      const controller = new MembershipsController(memberships as never);
      expect(() =>
        controller.suspend({ accessActor: actor }, 'org', 'member', body),
      ).toThrow('Membership suspension does not accept request fields.');
      expect(memberships.setStatus).not.toHaveBeenCalled();
    },
  );
});
