import { authorizationMode } from '../common/auth/authorization-mode';
import { registerAs } from '@nestjs/config';

export type TrustedIssuer = {
  issuer: string;
  audience: string;
  identityType: 'workforce_user' | 'customer_user' | 'service_account';
  jwksUri: string;
};

const split = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export default registerAs('access', () => {
  const defaultAudience = process.env.ACCESS_EXPECTED_AUDIENCE ?? 'access-api';
  const defaultJwksUri =
    process.env.IDENTITY_JWKS_URI ??
    'http://localhost:4000/.well-known/jwks.json';
  const issuers = split(process.env.ACCESS_TRUSTED_ISSUERS);
  const port = Number(process.env.PORT ?? 3019);

  return {
    authorizationMode: authorizationMode(),
    bindHost: process.env.ACCESS_BIND_HOST || undefined,
    legalServiceClientId: process.env.LEGAL_SERVICE_CLIENT_ID ?? '',
    port,
    expectedAudience: defaultAudience,
    issuer: process.env.ACCESS_ISSUER ?? `http://localhost:${port}`,
    contextTokenTtlSeconds: Number(
      process.env.ACCESS_CONTEXT_TOKEN_TTL_SECONDS ?? 900,
    ),
    contextCacheTtlSeconds: Number(
      process.env.ACCESS_CONTEXT_CACHE_TTL_SECONDS ?? 60,
    ),
    identityIntrospection: {
      url:
        process.env.IDENTITY_INTROSPECTION_URL ??
        'http://localhost:4000/oauth/introspect',
      issuer:
        process.env.IDENTITY_ISSUER ?? issuers[0] ?? 'http://localhost:4000',
      clientId: process.env.IDENTITY_INTROSPECTION_CLIENT_ID ?? 'access',
      clientSecret: process.env.IDENTITY_INTROSPECTION_CLIENT_SECRET,
    },
    jwks: {
      kid: process.env.ACCESS_JWKS_KEY_KID ?? 'access-dev-rs256',
      privateKeyPath: process.env.ACCESS_JWKS_PRIVATE_KEY_PATH,
    },
    redis: {
      host: process.env.ACCESS_REDIS_HOST,
      port: Number(process.env.ACCESS_REDIS_PORT ?? 6379),
      username: process.env.ACCESS_REDIS_USERNAME,
      password: process.env.ACCESS_REDIS_PASSWORD,
      db: Number(process.env.ACCESS_REDIS_DB ?? 0),
      tls: process.env.ACCESS_REDIS_TLS === 'true',
    },
    trustedIssuers: issuers.map<TrustedIssuer>((issuer) => ({
      issuer,
      audience: defaultAudience,
      identityType: issuer.includes('accounts.')
        ? 'customer_user'
        : 'workforce_user',
      jwksUri: defaultJwksUri,
    })),
  };
});
