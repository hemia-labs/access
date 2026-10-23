import { ConfigService } from '@nestjs/config';
import { importJWK, jwtVerify } from 'jose';
import { AccessActor } from '../../../../../apps/api/src/common/auth/access-actor.type';
import { AccessJwksService } from '../../../../../apps/api/src/modules/access-context/jwks/access-jwks.service';
import { ConsoleAuthorizationService } from '../../../../../apps/api/src/modules/access-context/authorization/console-authorization.service';

describe('Console signed authorization', () => {
  const actor: AccessActor = {
    issuer: 'http://identity.test',
    subjectId: 'operator',
    identityReferenceId: 'identity-1',
    identityType: 'workforce_user',
  };
  const authority = () => ({
    membership_id: 'membership-1',
    context_version: 3,
    membership_expires_at: null,
    role_expires_at: null,
    permission_expires_at: null,
    product_expires_at: null,
  });
  const jwks = new AccessJwksService(
    new ConfigService({ access: { issuer: 'http://access.test' } }),
  );
  const key = () => importJWK(jwks.getPublicJwks().keys[0], 'RS256');

  const setup = () => {
    const query = jest.fn().mockResolvedValue([authority()]);
    return {
      query,
      service: new ConsoleAuthorizationService({ query } as never, jwks),
    };
  };
  const verify = async (token: string) =>
    jwtVerify(token, await key(), {
      algorithms: ['RS256'],
      issuer: 'http://access.test',
      audience: 'console-api',
      typ: 'hemia-context+jwt',
      requiredClaims: ['iat', 'nbf', 'exp', 'jti', 'sub'],
    });

  it('signs the v1 Console policy, bound to the authenticated human', async () => {
    const { service, query } = setup();
    const result = await service.resolve(actor, 'organization-1');
    const { payload, protectedHeader } = await verify(result.context_token);
    expect(protectedHeader).toMatchObject({
      alg: 'RS256',
      typ: 'hemia-context+jwt',
      kid: 'access-dev-rs256',
    });
    expect(payload).toMatchObject({
      sub: actor.subjectId,
      identity_issuer: actor.issuer,
      identity_reference_id: actor.identityReferenceId,
      organization_id: 'organization-1',
      organization_status: 'active',
      membership_id: 'membership-1',
      membership_status: 'active',
      product_code: 'console',
      product_status: 'enabled',
      contract_version: 1,
      context_version: 3,
      global_roles: ['platform_super_admin'],
      permissions: ['*'],
    });
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(payload.nbf).toBe(payload.iat);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'organization-1',
      actor.identityReferenceId,
      actor.issuer,
      actor.subjectId,
    ]);
  });

  it.each([
    'membership_expires_at',
    'role_expires_at',
    'permission_expires_at',
    'product_expires_at',
  ])('bounds the token by %s', async (field) => {
    const { service, query } = setup();
    const expiration = new Date(Date.now() + 60000);
    query.mockResolvedValue([{ ...authority(), [field]: expiration }]);
    const result = await service.resolve(actor, 'organization-1');
    const { payload } = await verify(result.context_token);
    expect(payload.exp).toBe(Math.floor(expiration.getTime() / 1000));
  });

  it('rejects authority that expires between the query and signing', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([
      { ...authority(), role_expires_at: new Date(Date.now() - 1000) },
    ]);
    await expect(
      service.resolve(actor, 'organization-1'),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it('does not mint contexts for service accounts or another audience', async () => {
    const { service, query } = setup();
    await expect(
      service.resolve({ ...actor, identityType: 'service_account' }, 'org'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.resolve(actor, 'org', 'billing-api'),
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('queries again and rejects a revoked grant without using the previous token', async () => {
    const { service, query } = setup();
    const first = await service.resolve(actor, 'organization-1');
    const second = await service.resolve(actor, 'organization-1');
    expect((await verify(first.context_token)).payload.jti).not.toBe(
      (await verify(second.context_token)).payload.jti,
    );
    query.mockResolvedValue([]);
    await expect(
      service.resolve(actor, 'organization-1'),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('propagates database failure without minting a replacement token', async () => {
    const { service, query } = setup();
    await service.resolve(actor, 'organization-1');
    query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.resolve(actor, 'organization-1')).rejects.toThrow(
      'database unavailable',
    );
  });
});
