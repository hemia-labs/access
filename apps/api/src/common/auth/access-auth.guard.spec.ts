import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createSign, generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AccessAuthGuard } from './access-auth.guard';

describe('AccessAuthGuard', () => {
  let server: Server;
  let jwksUri: string;
  let privateKey: string;

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
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

  it('accepts a valid RS256 token', async () => {
    const guard = createGuard();
    const request = { headers: { authorization: `Bearer ${await token()}` } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('accessActor.identityReferenceId', 'ref-id');
  });

  it('rejects an invalid audience', async () => {
    const guard = createGuard();
    const request = {
      headers: {
        authorization: `Bearer ${await token({ audience: 'other-api' })}`,
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
        authorization: `Bearer ${await token({ issuer: 'https://evil.test' })}`,
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
      serviceIdentityReferences(),
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
    expect(request).toHaveProperty('accessActor.identityType', 'service_account');
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
      serviceIdentityReferences(),
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

  const config = () =>
    ({
      get: jest.fn().mockReturnValue([
        {
          issuer: 'http://localhost:4000',
          audience: 'access-api',
          identityType: 'workforce_user',
          jwksUri,
        },
      ]),
    }) as unknown as ConfigService;

  const identityReferences = () =>
    ({
      findOrCreateFromClaims: jest.fn().mockResolvedValue({
        id: 'ref-id',
        issuer: 'http://localhost:4000',
        subjectId: 'user-id',
        identityType: 'workforce_user',
      }),
    }) as never;

  const serviceConfig = () =>
    ({
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'access.expectedAudience' ? 'access-api' : fallback,
      ),
      getOrThrow: jest.fn().mockReturnValue({
        url: 'http://localhost:4000/oauth/introspect',
        issuer: 'http://localhost:4000',
        clientId: 'access',
        clientSecret: 'secret',
      }),
    }) as unknown as ConfigService;

  const serviceIdentityReferences = () =>
    ({
      findOrCreateFromClaims: jest.fn().mockResolvedValue({
        id: 'service-ref-id',
        issuer: 'http://localhost:4000',
        subjectId: 'console-access-admin',
        identityType: 'service_account',
      }),
    }) as never;

  const createGuard = () =>
    new AccessAuthGuard(
      config(),
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

  const signJwt = (payload: Record<string, unknown>) => {
    const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'test-key' }));
    const body = base64url(JSON.stringify(payload));
    const input = `${header}.${body}`;
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey);
    return `${input}.${base64url(signature)}`;
  };

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
