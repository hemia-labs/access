import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createSign, generateKeyPairSync } from 'crypto';
import { importJWK, jwtVerify } from 'jose';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ProblemDetailsFilter } from '../src/common/errors/problem-details.filter';
import { AppModule } from '../src/app.module';

describe('Access API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let privateKey: string;
  let dataSource: DataSource;

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicJwk = keys.publicKey.export({ format: 'jwk' });
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/oauth/introspect'
            ? {
                active: true,
                aud: 'access-api',
                client_id: 'console-access-admin',
                exp: Math.floor(Date.now() / 1000) + 300,
                scope:
                  'organization.read organization.update organization.archive membership.read membership.invite membership.suspend membership.revoke role.read role.assign role.revoke',
              }
            : { keys: [{ ...publicJwk, kid: 'e2e-key' }] },
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));

    process.env.ACCESS_TRUSTED_ISSUERS = 'http://localhost:4000';
    process.env.ACCESS_EXPECTED_AUDIENCE = 'access-api';
    process.env.IDENTITY_JWKS_URI = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
    process.env.IDENTITY_INTROSPECTION_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/introspect`;
    process.env.IDENTITY_INTROSPECTION_CLIENT_SECRET = 'e2e-secret';

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.runMigrations();
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('/health/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
  });

  it('rejects organization requests without bearer token', () => {
    return request(app.getHttpServer())
      .post('/v1/organizations')
      .send({ code: 'missing-auth', slug: 'missing-auth', name: 'Missing', type: 'customer' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('ACCESS_UNAUTHENTICATED'));
  });

  it('creates and manages an organization with a valid token', async () => {
    const token = adminToken();
    const suffix = Date.now().toString();
    const created = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('authorization', `Bearer ${token}`)
      .send({
        code: `acme-${suffix}`,
        slug: `acme-${suffix}`,
        name: 'ACME Corporation',
        legalName: 'ACME Corporation S.A. de C.V.',
        type: 'customer',
        countryCode: 'MX',
        timezone: 'America/Mexico_City',
      })
      .expect(201);

    const id = created.body.id;

    await request(app.getHttpServer())
      .get('/v1/organizations')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/organizations/${id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/v1/organizations/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'ACME Updated' })
      .expect(200)
      .expect(({ body }) => expect(body.name).toBe('ACME Updated'));
    await request(app.getHttpServer())
      .post(`/v1/organizations/${id}/suspend`)
      .set('authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('suspended'));
    await request(app.getHttpServer())
      .post(`/v1/organizations/${id}/activate`)
      .set('authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('active'));
    await request(app.getHttpServer())
      .post(`/v1/organizations/${id}/archive`)
      .set('authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('archived'));
  });

  it('creates membership, assigns role, and writes audit/outbox', async () => {
    const token = adminToken();
    const suffix = `${Date.now()}-membership`;
    const organization = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('authorization', `Bearer ${token}`)
      .send({
        code: `org-${suffix}`,
        slug: `org-${suffix}`,
        name: 'Membership Org',
        type: 'customer',
        status: 'active',
      })
      .expect(201);

    const membership = await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships`)
      .set('authorization', `Bearer ${token}`)
      .send({
        identity: {
          issuer: 'http://localhost:4000',
          subject_id: `member-${suffix}`,
          email: `member-${suffix}@hemia.local`,
        },
        membership_type: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/activate`)
      .set('authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.contextVersion).toBe(2));

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/roles`)
      .set('authorization', `Bearer ${token}`)
      .send({ roleCode: 'organization_member' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/suspend`)
      .set('authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/revoke`)
      .set('authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/roles')
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.some((role: { code: string }) => role.code === 'organization_member')).toBe(true),
      );
    await request(app.getHttpServer())
      .get('/v1/permissions')
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.some((permission: { code: string }) => permission.code === 'membership.read')).toBe(true),
      );

    const audit = await dataSource.query(
      'select count(*)::int as count, max(actor_subject_id) as actor_subject_id from audit_events where resource_id = $1',
      [membership.body.id],
    );
    const outbox = await dataSource.query(
      'select count(*)::int as count from outbox_events where aggregate_id = $1',
      [membership.body.id],
    );

    expect(audit[0].count).toBeGreaterThan(0);
    expect(audit[0].actor_subject_id).toBe('console-access-admin');
    expect(outbox[0].count).toBeGreaterThan(0);
  });

  it('resolves access context and emits a verifiable context token', async () => {
    const adminToken = adminServiceToken();
    const suffix = `${Date.now()}-context`;
    const memberSubject = `member-${suffix}`;
    const organization = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        code: `ctx-${suffix}`,
        slug: `ctx-${suffix}`,
        name: 'Context Org',
        type: 'customer',
        status: 'active',
      })
      .expect(201);

    const membership = await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        identity: {
          issuer: 'http://localhost:4000',
          subject_id: memberSubject,
          email: `${memberSubject}@hemia.local`,
        },
        membership_type: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/activate`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/memberships/${membership.body.id}/roles`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ roleCode: 'organization_member' })
      .expect(201);

    const memberToken = await accessToken(memberSubject, `${memberSubject}@hemia.local`);
    await request(app.getHttpServer())
      .get('/v1/me/context')
      .set('authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.organizations[0]).toMatchObject({
          organization_id: organization.body.id,
          membership_id: membership.body.id,
        });
        expect(body.organizations[0].roles).toContain('organization_member');
        expect(body.organizations[0].permissions).toContain('organization.read');
      });

    const resolved = await request(app.getHttpServer())
      .post('/v1/me/context/resolve')
      .set('authorization', `Bearer ${memberToken}`)
      .send({ organization_id: organization.body.id, audience: 'docs-api' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.authorized).toBe(true);
        expect(body.context_token).toEqual(expect.any(String));
      });

    await request(app.getHttpServer())
      .post('/v1/access/check')
      .set('authorization', `Bearer ${memberToken}`)
      .send({ organization_id: organization.body.id, permission: 'organization.read' })
      .expect(201)
      .expect(({ body }) => expect(body.allowed).toBe(true));
    await request(app.getHttpServer())
      .post('/v1/access/check')
      .set('authorization', `Bearer ${memberToken}`)
      .send({ organization_id: organization.body.id, permission: 'role.assign' })
      .expect(201)
      .expect(({ body }) => expect(body.allowed).toBe(false));

    const jwks = await request(app.getHttpServer())
      .get('/.well-known/jwks.json')
      .expect(200);
    const key = await importJWK(jwks.body.keys[0], 'RS256');
    await expect(
      jwtVerify(resolved.body.context_token, key, {
        issuer: 'http://localhost:3019',
        audience: 'docs-api',
      }),
    ).resolves.toMatchObject({
      payload: {
        sub: memberSubject,
        organization_id: organization.body.id,
      },
    });
  });

  it('accepts invitation, provisions product, and resolves product context', async () => {
    const adminToken = adminServiceToken();
    const suffix = `${Date.now()}-phase4`;
    const memberSubject = `invitee-${suffix}`;
    const memberEmail = `${memberSubject}@hemia.local`;
    const productCode = `docs-${suffix}`;
    const organization = await request(app.getHttpServer())
      .post('/v1/organizations')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        code: `p4-${suffix}`,
        slug: `p4-${suffix}`,
        name: 'Phase 4 Org',
        type: 'customer',
        status: 'active',
      })
      .expect(201);

    const invitation = await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/invitations`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        email: memberEmail,
        role_codes: ['organization_member'],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.token).toEqual(expect.any(String));
        expect(body.tokenHash).toBeUndefined();
      });

    const memberToken = await accessToken(memberSubject, memberEmail);
    const accepted = await request(app.getHttpServer())
      .post('/v1/invitations/accept')
      .set('authorization', `Bearer ${memberToken}`)
      .send({ token: invitation.body.token })
      .expect(201)
      .expect(({ body }) => expect(body.accepted).toBe(true));

    await request(app.getHttpServer())
      .post('/v1/products')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        code: productCode,
        name: 'Docs Test',
        audience: 'internal',
        provisioning_mode: 'event_driven',
      })
      .expect(201);

    const enabled = await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.body.id}/products/${productCode}/enable`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ source: 'manual' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('provisioning'));

    await request(app.getHttpServer())
      .post('/v1/internal/product-instances')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        organization_id: organization.body.id,
        product_code: productCode,
        external_tenant_id: `tenant-${suffix}`,
        status: 'ready',
      })
      .expect(201)
      .expect(({ body }) => expect(body.externalTenantId).toBe(`tenant-${suffix}`));

    await request(app.getHttpServer())
      .get(`/v1/me/context?product=${productCode}`)
      .set('authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.organizations[0]).toMatchObject({
          organization_id: organization.body.id,
          membership_id: accepted.body.membership_id,
          product: {
            code: productCode,
            status: 'enabled',
            provisioning_status: 'ready',
            external_tenant_id: `tenant-${suffix}`,
          },
        });
      });

    const outbox = await dataSource.query(
      'select count(*)::int as count from outbox_events where aggregate_id in ($1, $2)',
      [invitation.body.id, enabled.body.id],
    );
    expect(outbox[0].count).toBeGreaterThanOrEqual(2);
  });

  const accessToken = (subject = 'user-id', email = 'admin@hemia.local') =>
    signJwt({
      iss: 'http://localhost:4000',
      aud: 'access-api',
      sub: subject,
      email,
      name: 'Admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });

  const adminServiceToken = () => 'opaque-console-access-admin-token';
  const adminToken = adminServiceToken;

  const signJwt = (payload: Record<string, unknown>) => {
    const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'e2e-key' }));
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
});
