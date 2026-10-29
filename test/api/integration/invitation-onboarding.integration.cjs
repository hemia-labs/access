// Runs both built services with real JWT signatures and in-memory persistence; never sends email.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { createServer } = require('node:http');
const { generateKeyPairSync, createPublicKey } = require('node:crypto');
const workspace = resolve(__dirname, '../../../..');
const accessRoot = resolve(workspace, 'access/apps/api');
const identityRoot = resolve(workspace, 'identity/backend');
const accessRequire = createRequire(resolve(accessRoot, 'package.json'));
const identityRequire = createRequire(resolve(identityRoot, 'package.json'));
const loadAccess = name => require(resolve(accessRoot, 'dist/src', name));
const loadIdentity = name => require(resolve(identityRoot, 'dist/src', name));
const { ConfigService } = accessRequire('@nestjs/config');
const { JwtService } = identityRequire('@nestjs/jwt');
const { InvitationsService } = loadAccess('modules/invitations/invitations.service.js');
const { PublicInvitationsController } = loadAccess('modules/invitations/public-invitations.controller.js');
const { AccessJwksService } = loadAccess('modules/access-context/jwks/access-jwks.service.js');
const { Invitation } = loadAccess('modules/invitations/entities/invitation.entity.js');
const { Membership } = loadAccess('modules/memberships/entities/membership.entity.js');
const { Organization } = loadAccess('modules/organizations/entities/organization.entity.js');
const { Role } = loadAccess('modules/roles/entities/role.entity.js');
const { InvitationOnboardingService } = loadIdentity('modules/auth/invitation-onboarding.service.js');
const { UsersService } = loadIdentity('modules/users/users.service.js');
const { AuthService } = loadIdentity('modules/auth/auth.service.js');

async function run() {
  const identityKeys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const invitations = new Map(); const users = new Map(); const references = new Map(); const memberships = new Map(); const emails = [];
  let id = 0;
  const org = { id: 'org', type: 'customer', name: 'Test organization', status: 'active' };
  const repository = {
    create: value => ({ id: `invitation-${++id}`, status: 'pending', updatedAt: new Date(), ...value }),
    save: async value => { invitations.set(value.id, value); return value; },
    findOneBy: async where => [...invitations.values()].find(i => Object.entries(where).every(([key, value]) => i[key] === value)) ?? null,
    findOne: async ({ where, relations }) => { const found = await repository.findOneBy(where); return found ? Object.assign(found, relations ? { organization: org } : {}) : null; },
  };
  const membershipRepository = { create: value => ({ id: 'membership', ...value }), findOneBy: async where => [...memberships.values()].find(m => m.organizationId === where.organizationId && m.identityReferenceId === where.identityReferenceId) ?? null, save: async value => { memberships.set(value.id, value); return value; } };
  const manager = { query: async () => [{ id: 'admin' }], getRepository: entity => entity === Invitation ? repository : entity === Organization ? { findOne: async () => org } : entity === Role ? { findOne: async () => ({ id: 'role', scope: 'organization', status: 'active' }) } : entity === Membership ? membershipRepository : { upsert: async () => {} } };
  const identities = {
    findActiveById: async id => { const identity = references.get(id); assert.equal(identity?.status, 'active'); return identity; },
    findOrCreateFromClaims: async input => { const reference = { id: input.subjectId, issuer: input.issuer, subjectId: input.subjectId, identityType: input.identityType, emailSnapshot: input.email, status: 'active' }; references.set(reference.id, reference); return reference; },
  };
  const cache = { key: id => id, del: async () => {} };
  const service = new InvitationsService({ transaction: fn => fn(manager), getRepository: entity => entity === Organization ? { findOneByOrFail: async () => org } : { findOneBy: async () => null } }, repository, identities, { record: async () => {} }, { record: async () => {} }, cache, { send: async (email, token) => { emails.push({ email, token }); } });
  let publicController; let accessKeys;
  const http = createServer(async (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/identity/jwks') return res.end(JSON.stringify({ keys: [{ ...createPublicKey(identityKeys.publicKey).export({ format: 'jwk' }), kid: 'identity-test' }] }));
      if (req.url === '/access/jwks') return res.end(JSON.stringify(accessKeys.getPublicJwks()));
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const request = { ip: 'test-client' };
      const result = req.url.endsWith('/preview') ? await publicController.preview(request, body, res) : await publicController.accept(request, body);
      res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = error.getStatus?.() ?? 500; res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  const accessConfig = new ConfigService({ access: { issuer: base, identityIntrospection: { issuer: 'https://id.test' }, trustedIssuers: [{ issuer: 'https://id.test', jwksUri: `${base}/identity/jwks`, identityType: 'workforce_user' }] } });
  accessKeys = new AccessJwksService(accessConfig);
  publicController = new PublicInvitationsController(service, accessKeys, identities, accessConfig);
  const userRepository = { create: value => ({ id: 'new-user', ...value }), save: async value => { users.set(value.id, value); return value; }, findOne: async ({ where }) => [...users.values()].find(u => Object.entries(where).every(([k, v]) => u[k] === v)) ?? null };
  const userService = new UsersService(userRepository, { emit: async () => {} });
  const config = new ConfigService({ ACCESS_API_URL: base, ACCESS_ISSUER: base, ACCESS_JWKS_URI: `${base}/access/jwks`, app: { issuer: 'https://id.test' }, jwt: { accessSecret: 's'.repeat(64) } });
  const jwt = new JwtService();
  const onboarding = new InvitationOnboardingService(config, jwt, { getActiveKey: async () => ({ ...identityKeys, kid: 'identity-test' }) }, userService);
  const auth = new AuthService(config, jwt, userService, { create: async input => ({ ...input, id: 'session', sessionFamilyId: 'family' }) }, { create: async () => {} });
  const admin = { identityReferenceId: 'admin', issuer: 'https://id.test', subjectId: 'admin', identityType: 'workforce_user' };
  try {
    const created = await service.create(admin, org.id, { email: 'Invitee@example.test' });
    assert.equal(created.delivery, 'sent'); assert.equal(created.token, undefined); assert.equal(created.tokenHash, undefined);
    assert.equal(emails[0].email, 'invitee@example.test');
    const oldToken = emails[0].token;
    const resent = await service.resend(admin, created.id); assert.equal(resent.delivery, 'sent');
    const token = emails[1].token; assert.notEqual(oldToken, token);
    await assert.rejects(() => onboarding.preview(oldToken));
    const preview = await onboarding.preview(token); assert.equal(preview.organization, org.name);
    const user = await onboarding.register({ token, firstName: 'Invited', lastName: 'Person', password: 'secure-password' });
    assert.equal(user.emailVerified, true); assert.equal(user.status, 'active'); assert.ok(user.passwordHash); assert.notEqual(user.passwordHash, 'secure-password');
    const invalidProof = jwt.sign({ email: user.email, email_verified: true, token_hash: require('node:crypto').createHash('sha256').update(token).digest('hex') }, { privateKey: identityKeys.privateKey, algorithm: 'RS256', keyid: 'identity-test', issuer: 'https://id.test', subject: user.id, audience: 'wrong-audience', expiresIn: '60s' });
    const rejected = await fetch(base + '/v1/public/invitations/accept', { method: 'POST', body: JSON.stringify({ token, identity_proof: invalidProof }) });
    assert.equal(rejected.status, 401); assert.equal(memberships.size, 0);
    const session = await auth.loginExternalUser(user, {}); assert.equal(session.session.sessionId, 'session');
    assert.equal((await onboarding.accept(token, user.id)).accepted, true);
    assert.equal(memberships.size, 1); assert.equal(invitations.get(created.id).status, 'accepted');
    await assert.rejects(() => onboarding.accept(token, user.id));
    await assert.rejects(() => onboarding.register({ token, firstName: 'Other', lastName: '', password: 'secure-password' }));
    const revoked = await service.create(admin, org.id, { email: 'revoked@example.test' });
    const revokedToken = emails.at(-1).token;
    await service.revoke(admin, revoked.id);
    await assert.rejects(() => onboarding.preview(revokedToken));
    console.log('PASS: create -> email handoff -> signed preview -> real password registration -> session -> authenticated acceptance -> membership; replay rejected');
  } finally { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
