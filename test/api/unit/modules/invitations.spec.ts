import { createHash } from 'crypto';
import { InvitationsService } from '../../../../apps/api/src/modules/invitations/invitations.service';
import { Invitation } from '../../../../apps/api/src/modules/invitations/entities/invitation.entity';
import { Organization } from '../../../../apps/api/src/modules/organizations/entities/organization.entity';
import { Role } from '../../../../apps/api/src/modules/roles/entities/role.entity';
import { Membership } from '../../../../apps/api/src/modules/memberships/entities/membership.entity';

const token = 'a'.repeat(43);
const actor = {
  identityReferenceId: 'identity',
  issuer: 'https://id.example.test',
  subjectId: 'user',
  identityType: 'workforce_user' as const,
};
function fixture(email: string | null = 'invitee@example.test') {
  const invitation = {
    id: 'invite',
    organizationId: 'org',
    createdByIdentityId: 'admin',
    emailNormalized: 'invitee@example.test',
    status: 'pending',
    tokenHash: createHash('sha256').update(token).digest('hex'),
    roleCodes: ['organization_member'],
    expiresAt: new Date(Date.now() + 60000),
    identityIssuerHint: null,
  };
  const invitations = {
    findOneBy: jest.fn(() => Promise.resolve(invitation)),
    findOne: jest.fn(() => Promise.resolve(invitation)),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const memberships = {
    findOneBy: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((v: Record<string, unknown>) => v),
    save: jest.fn((v: Record<string, unknown>) =>
      Promise.resolve({ ...v, id: 'membership' }),
    ),
  };
  const identities = {
    findActiveById: jest.fn(() =>
      Promise.resolve({ id: 'identity', emailSnapshot: email }),
    ),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Invitation
        ? invitations
        : entity === Organization
          ? {
              findOne: () =>
                Promise.resolve({
                  status: 'active',
                  type: 'customer',
                  name: 'Hemia',
                }),
            }
          : entity === Role
            ? {
                findOne: () =>
                  Promise.resolve({
                    id: 'role',
                    scope: 'organization',
                    status: 'active',
                  }),
              }
            : entity === Membership
              ? memberships
              : { upsert: jest.fn() },
    ),
  };
  const cache = { key: jest.fn((id: string) => id), del: jest.fn() };
  const mail = { sendWelcome: jest.fn().mockResolvedValue(undefined) };
  const service = new InvitationsService(
    {
      transaction: (fn: (m: unknown) => unknown) =>
        Promise.resolve(fn(manager)),
    } as never,
    invitations as never,
    identities as never,
    { record: jest.fn() },
    { record: jest.fn() } as never,
    cache as never,
    mail as never,
  );
  return {
    service,
    invitation,
    invitations,
    identities,
    memberships,
    cache,
    mail,
  };
}
describe('Invitation acceptance', () => {
  it.each([null, 'other@example.test'])(
    'rejects missing or mismatched email %s before granting membership',
    async (email) => {
      const f = fixture(email);
      await expect(f.service.accept(actor, { token })).rejects.toMatchObject({
        code: 'ACCESS_INVITATION_EMAIL_MISMATCH',
      });
      expect(f.memberships.save).not.toHaveBeenCalled();
      expect(f.mail.sendWelcome).not.toHaveBeenCalled();
      expect(f.invitation.status).toBe('pending');
    },
  );
  it('accepts the matching identity, assigns membership once and invalidates cache', async () => {
    const f = fixture();
    await expect(f.service.accept(actor, { token })).resolves.toEqual({
      accepted: true,
      membership_id: 'membership',
    });
    expect(f.invitations.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(f.invitation.status).toBe('accepted');
    expect(f.cache.del).toHaveBeenCalledWith('identity');
    await expect(f.service.accept(actor, { token })).rejects.toMatchObject({
      code: 'ACCESS_INVITATION_INVALID',
    });
    expect(f.memberships.save).toHaveBeenCalledTimes(1);
    expect(f.mail.sendWelcome).toHaveBeenCalledTimes(1);
    expect(f.mail.sendWelcome).toHaveBeenCalledWith(
      'invitee@example.test',
      expect.objectContaining({ organizationName: 'Hemia' }),
    );
  });
  it('does not undo accepted membership when welcome delivery fails', async () => {
    const f = fixture();
    f.mail.sendWelcome.mockRejectedValue(new Error('SES failed'));
    await expect(f.service.accept(actor, { token })).resolves.toEqual({
      accepted: true,
      membership_id: 'membership',
    });
    expect(f.invitation.status).toBe('accepted');
  });
  it.each(['revoked', 'expired', 'accepted'])(
    'rejects %s invitations',
    async (status) => {
      const f = fixture();
      f.invitation.status = status;
      await expect(f.service.accept(actor, { token })).rejects.toThrow();
      expect(f.memberships.save).not.toHaveBeenCalled();
    },
  );
  it('rejects a token replaced by resend while waiting for the lock', async () => {
    const f = fixture();
    f.invitations.findOne.mockResolvedValue({
      ...f.invitation,
      tokenHash: 'b'.repeat(64),
    });
    await expect(f.service.accept(actor, { token })).rejects.toThrow();
    expect(f.memberships.save).not.toHaveBeenCalled();
  });
  it('rejects elapsed pending invitations', async () => {
    const f = fixture();
    f.invitation.expiresAt = new Date(0);
    await expect(f.service.accept(actor, { token })).rejects.toMatchObject({
      code: 'ACCESS_INVITATION_EXPIRED',
    });
    expect(f.memberships.save).not.toHaveBeenCalled();
  });
  it('requires issuer hint to match', async () => {
    const f = fixture();
    Object.assign(f.invitation, { identityIssuerHint: 'other-issuer' });
    await expect(f.service.accept(actor, { token })).rejects.toThrow();
    expect(f.memberships.save).not.toHaveBeenCalled();
  });
});
