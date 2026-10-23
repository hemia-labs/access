import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createSign, generateKeyPairSync, randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AccessAuthGuard } from '../../../../../apps/api/src/common/auth/access-auth.guard';
import { MembershipsController } from '../../../../../apps/api/src/modules/memberships/memberships.controller';

describe('AccessAuthGuard', () => {
  let server: Server;
  let jwksUri: string;
  let privateKey: string;

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keys.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();
    const publicJwk = keys.publicKey.export({ format: 'jwk' });
    server = createServer((_, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid RS256 token', async () => {
    const guard = createGuard();
    const request = { headers: { authorization: `Bearer ${token()}` } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('accessActor.identityReferenceId', 'ref-id');
  });

  it('rejects an invalid audience', async () => {
    const guard = createGuard();
    const request = {
      headers: {
        authorization: `Bearer ${token({ audience: 'other-api' })}`,
      },
    };

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({
      code: 'ACCESS_TOKEN_INVALID',
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects an untrusted issuer', async () => {
    const guard = createGuard();
    const request = {
      headers: {
        authorization: `Bearer ${token({ issuer: 'https://evil.test' })}`,
      },
    };

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({
      code: 'ACCESS_ISSUER_NOT_ALLOWED',
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('accepts an introspected service token with the required scope', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          aud: 'access-api',
          client_id: 'console-access-admin',
          exp: Math.floor(Date.now() / 1000) + 300,
          scope: 'organization.read',
        }),
        { status: 200 },
      ),
    );
    const request = {
      headers: { authorization: 'Bearer opaque-service-token' },
      params: {},
    };
    const guard = new AccessAuthGuard(
      serviceConfig(),
      serviceIdentityReferences() as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue({
          permission: 'organization.read',
          global: true,
        }),
      } as unknown as Reflector,
      { query: jest.fn() } as unknown as DataSource,
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty(
      'accessActor.subjectId',
      'console-access-admin',
    );
    expect(request).toHaveProperty(
      'accessActor.identityType',
      'service_account',
    );
  });

  it('rejects a service token without the required scope', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          aud: 'access-api',
          client_id: 'console-access-admin',
          exp: Math.floor(Date.now() / 1000) + 300,
          scope: 'organization.read',
        }),
        { status: 200 },
      ),
    );
    const guard = new AccessAuthGuard(
      serviceConfig(),
      serviceIdentityReferences() as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue({
          permission: 'organization.archive',
          global: true,
        }),
      } as unknown as Reflector,
      { query: jest.fn() } as unknown as DataSource,
    );

    await expect(
      guard.canActivate(
        context({
          headers: { authorization: 'Bearer opaque-service-token' },
          params: {},
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ACCESS_FORBIDDEN',
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('authorizes a signed service JWT by its introspected scopes', async () => {
    const fetch = mockIntrospection();
    const identities = serviceIdentityReferences();
    const database = { query: jest.fn() };
    const guard = serviceGuard(identities, database);
    const accessToken = serviceToken();
    const request = {
      headers: { authorization: `Bearer ${accessToken}` },
      params: {},
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty(
      'accessActor.identityType',
      'service_account',
    );
    expect(request).toHaveProperty(
      'accessActor.subjectId',
      'console-access-admin',
    );
    expect(request).toHaveProperty('accessActor.scopes', ['organization.read']);
    expect(identities.findOrCreateFromClaims).toHaveBeenCalledWith({
      issuer: 'http://localhost:4000',
      subjectId: 'console-access-admin',
      identityType: 'service_account',
      email: null,
      displayName: 'console-access-admin',
      avatarUrl: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/oauth/introspect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'access',
          client_secret: 'secret',
          token: accessToken,
        }),
      }),
    );
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects a signed service JWT without the required scope', async () => {
    mockIntrospection({ scope: 'organization.update' });
    const database = { query: jest.fn() };
    const guard = serviceGuard(serviceIdentityReferences(), database);

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${serviceToken()}` } }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN', status: 403 });
    expect(database.query).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked token', { active: false }],
    ['different client', { client_id: 'another-client' }],
    ['different audience', { aud: 'billing-api' }],
    ['expired record', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['invalid expiration', { exp: '9999999999' }],
    ['invalid scopes', { scope: ['organization.read'] }],
    ['user session', { session_id: 'user-session' }],
  ])('rejects service introspection with %s', async (_, result) => {
    mockIntrospection(result);
    const identities = serviceIdentityReferences();

    await expect(
      serviceGuard(identities).canActivate(
        context({ headers: { authorization: `Bearer ${serviceToken()}` } }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 });
    expect(identities.findOrCreateFromClaims).not.toHaveBeenCalled();
  });

  const now = Math.floor(Date.now() / 1000);
  const invalidContracts: Array<
    [string, Record<string, unknown>, Record<string, unknown>?]
  > = [
    ['missing client ID', { client_id: undefined }],
    ['empty client ID', { client_id: '' }],
    ['different subject', { sub: 'user-id' }],
    ['missing expiration', { exp: undefined }],
    ['missing issued-at', { iat: undefined }],
    ['missing token ID', { jti: undefined }],
    ['invalid scope', { scope: ['organization.read'] }],
    ['lifetime over 600 seconds', { iat: now, exp: now + 601 }],
    ['future issued-at', { iat: now + 90, exp: now + 690 }],
    ['expiration before issued-at', { iat: now + 10, exp: now + 5 }],
    ['expired token', { iat: now - 601, exp: now - 1 }],
    ['wrong audience', { aud: 'billing-api' }],
    ['user session', { session_id: 'user-session' }],
    ['wrong token type', {}, { typ: 'JWT' }],
    ['missing key ID', {}, { kid: undefined }],
  ];

  it.each(invalidContracts)(
    'rejects service JWT with %s',
    async (_, claims, header = {}) => {
      const fetch = mockIntrospection();
      const identities = serviceIdentityReferences();

      await expect(
        serviceGuard(identities).canActivate(
          context({
            headers: {
              authorization: `Bearer ${serviceToken(claims, header)}`,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 });
      expect(fetch).not.toHaveBeenCalledWith(
        'http://localhost:4000/oauth/introspect',
        expect.anything(),
      );
      expect(identities.findOrCreateFromClaims).not.toHaveBeenCalled();
    },
  );

  it.each(['access-workload-identity', 'access-api'])(
    'rejects the workload identity profile with audience %s before creating any identity',
    async (audience) => {
      const fetch = mockIntrospection();
      const identities = serviceIdentityReferences();
      const claims = {
        aud: audience,
        sub: randomUUID(),
        client_id: 'balanz-workload-local',
        credential_type: 'workload_identity',
        principal_type: 'workload',
        auth_method: 'spiffe_x509_mtls',
        environment: 'local',
        scope: 'workload.identity',
        workload_generation: '2',
        authority_generation: '1',
        cnf: { 'x5t#S256': Buffer.alloc(32).toString('base64url') },
        exp: Math.floor(Date.now() / 1000) + 120,
      };
      await expect(
        serviceGuard(identities).canActivate(
          context({
            headers: {
              authorization: `Bearer ${serviceToken(claims, { typ: 'hemia-workload+jwt' })}`,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 });
      expect(fetch).not.toHaveBeenCalledWith(
        'http://localhost:4000/oauth/introspect',
        expect.anything(),
      );
      expect(identities.findOrCreateFromClaims).not.toHaveBeenCalled();
    },
  );

  it('rejects a service JWT from a trusted user issuer', async () => {
    const fetch = mockIntrospection();
    const cfg = config();
    cfg.get.mockImplementation((key: string, fallback: unknown) =>
      key === 'access.trustedIssuers'
        ? [
            {
              issuer: 'https://accounts.hemia.test',
              audience: 'access-api',
              identityType: 'customer_user',
              jwksUri,
            },
          ]
        : fallback,
    );
    const guard = new AccessAuthGuard(
      cfg as unknown as ConfigService,
      serviceIdentityReferences() as never,
      { getAllAndOverride: jest.fn() } as unknown as Reflector,
      { query: jest.fn() } as unknown as DataSource,
    );

    await expect(
      guard.canActivate(
        context({
          headers: {
            authorization: `Bearer ${serviceToken({ iss: 'https://accounts.hemia.test' })}`,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 });
    expect(fetch).not.toHaveBeenCalledWith(
      'http://localhost:4000/oauth/introspect',
      expect.anything(),
    );
  });

  it('rejects a service JWT with a forged signature', async () => {
    const fetch = mockIntrospection();
    const [header, payload] = serviceToken().split('.');
    const forged = `${header}.${payload}.${Buffer.alloc(256).toString('base64url')}`;

    await expect(
      serviceGuard().canActivate(
        context({ headers: { authorization: `Bearer ${forged}` } }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 });
    expect(fetch).not.toHaveBeenCalledWith(
      'http://localhost:4000/oauth/introspect',
      expect.anything(),
    );
  });

  it.each([true, false])(
    'authorizes users by memberships: %s',
    async (allowed) => {
      const fetch = mockIntrospection();
      const database = {
        query: jest
          .fn()
          .mockResolvedValue(allowed ? [{ code: 'organization.read' }] : []),
      };
      const guard = new AccessAuthGuard(
        config() as unknown as ConfigService,
        identityReferences(),
        {
          getAllAndOverride: jest.fn().mockReturnValue({
            permission: 'organization.read',
            global: true,
          }),
        } as unknown as Reflector,
        database as unknown as DataSource,
      );
      const request = {
        params: {},
        headers: {
          authorization: `Bearer ${signJwt({
            iss: 'http://localhost:4000',
            aud: 'access-api',
            sub: 'user-id',
            client_id: 'console-access-admin',
            scope: 'organization.read',
            iat: now,
            exp: now + 600,
          })}`,
        },
      };

      if (allowed) {
        await expect(guard.canActivate(context(request))).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(context(request))).rejects.toMatchObject(
          {
            code: 'ACCESS_FORBIDDEN',
            status: 403,
          },
        );
      }
      expect(request).toHaveProperty(
        'accessActor.identityType',
        'workforce_user',
      );
      expect(request).not.toHaveProperty('accessActor.scopes');
      expect(database.query).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalledWith(
        'http://localhost:4000/oauth/introspect',
        expect.anything(),
      );
    },
  );

  it.each([true, false])(
    'enforces membership.suspend through the controller RBAC metadata: %s',
    async (allowed) => {
      const organizationId = '11111111-1111-4111-8111-111111111111';
      const database = {
        query: jest
          .fn()
          .mockResolvedValue(
            allowed
              ? [{ code: 'membership.suspend' }]
              : [{ code: 'membership.read' }],
          ),
      };
      const guard = new AccessAuthGuard(
        config() as unknown as ConfigService,
        identityReferences(),
        new Reflector(),
        database as unknown as DataSource,
      );
      const request = {
        headers: { authorization: `Bearer ${token()}` },
        params: { organizationId },
      };
      const executionContext = {
        getHandler: () =>
          Reflect.get(MembershipsController.prototype, 'suspend'),
        getClass: () => MembershipsController,
        switchToHttp: () => ({ getRequest: () => request }),
      } as never;
      if (allowed) {
        await expect(guard.canActivate(executionContext)).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(executionContext)).rejects.toMatchObject(
          { code: 'ACCESS_FORBIDDEN', status: 403 },
        );
      }
      expect(database.query).toHaveBeenCalledWith(expect.any(String), [
        'ref-id',
        organizationId,
        false,
      ]);
    },
  );

  const config = () => ({
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'access.trustedIssuers'
        ? [
            {
              issuer: 'http://localhost:4000',
              audience: 'access-api',
              identityType: 'workforce_user',
              jwksUri,
            },
          ]
        : key === 'access.expectedAudience'
          ? 'access-api'
          : fallback,
    ),
    getOrThrow: jest.fn().mockReturnValue({
      url: 'http://localhost:4000/oauth/introspect',
      issuer: 'http://localhost:4000',
      clientId: 'access',
      clientSecret: 'secret',
    }),
  });

  const identityReferences = () =>
    ({
      findOrCreateFromClaims: jest.fn().mockResolvedValue({
        id: 'ref-id',
        issuer: 'http://localhost:4000',
        subjectId: 'user-id',
        identityType: 'workforce_user',
      }),
    }) as never;

  const serviceConfig = () => config() as unknown as ConfigService;

  const serviceIdentityReferences = () => ({
    findOrCreateFromClaims: jest.fn().mockResolvedValue({
      id: 'service-ref-id',
      issuer: 'http://localhost:4000',
      subjectId: 'console-access-admin',
      identityType: 'service_account',
    }),
  });

  const createGuard = () =>
    new AccessAuthGuard(
      config() as unknown as ConfigService,
      identityReferences(),
      { getAllAndOverride: jest.fn() } as unknown as Reflector,
      { query: jest.fn() } as unknown as DataSource,
    );

  const token = (overrides: { issuer?: string; audience?: string } = {}) =>
    signJwt({
      iss: overrides.issuer ?? 'http://localhost:4000',
      aud: overrides.audience ?? 'access-api',
      sub: 'user-id',
      email: 'admin@hemia.local',
      name: 'Admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });

  const signJwt = (
    payload: Record<string, unknown>,
    headerOverrides: Record<string, unknown> = {},
  ) => {
    const header = base64url(
      JSON.stringify({ alg: 'RS256', kid: 'test-key', ...headerOverrides }),
    );
    const body = base64url(JSON.stringify(payload));
    const input = `${header}.${body}`;
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey);
    return `${input}.${base64url(signature)}`;
  };

  const serviceToken = (
    overrides: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
  ) =>
    signJwt(
      {
        iss: 'http://localhost:4000',
        aud: 'access-api',
        sub: 'console-access-admin',
        client_id: 'console-access-admin',
        grant_type: 'client_credentials',
        scope: 'organization.read',
        jti: randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
        ...overrides,
      },
      { typ: 'at+jwt', ...header },
    );

  const mockIntrospection = (overrides: Record<string, unknown> = {}) => {
    const fetch = global.fetch;
    return jest.spyOn(global, 'fetch').mockImplementation((url, options) =>
      url === 'http://localhost:4000/oauth/introspect'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                active: true,
                aud: 'access-api',
                client_id: 'console-access-admin',
                exp: Math.floor(Date.now() / 1000) + 600,
                scope: 'organization.read',
                ...overrides,
              }),
              { status: 200 },
            ),
          )
        : fetch(url, options),
    );
  };

  const serviceGuard = (
    identities = serviceIdentityReferences(),
    database = { query: jest.fn() },
  ) =>
    new AccessAuthGuard(
      serviceConfig(),
      identities as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue({
          permission: 'organization.read',
          global: true,
        }),
      } as unknown as Reflector,
      database as unknown as DataSource,
    );

  const base64url = (input: string | Buffer) =>
    Buffer.from(input)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');

  const context = (request: object) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;
});
