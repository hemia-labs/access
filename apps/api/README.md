# Hemia Access API

Backend NestJS de Hemia Access. Administra organizations, memberships, roles/permisos globales, invitations, product access, context tokens, auditoria y outbox.

Los JWT de usuario se autorizan con memberships y roles activos. Los tokens opacos de servicio se introspectan contra Identity y se autorizan por scope; Console usa el cliente `console-access-admin`.

Access no ejecuta login de usuario. Recibe tokens emitidos por Hemia ID o Customer Registry, los valida contra JWKS allowlisted y resuelve contexto organizacional.

## Configuracion

`src/config/access.config.ts` contiene toda la configuracion de Access, incluida la validacion de tokens entrantes:

```txt
PORT
ACCESS_ISSUER
ACCESS_EXPECTED_AUDIENCE
ACCESS_TRUSTED_ISSUERS
IDENTITY_JWKS_URI
ACCESS_CONTEXT_TOKEN_TTL_SECONDS
ACCESS_CONTEXT_CACHE_TTL_SECONDS
ACCESS_JWKS_KEY_KID
ACCESS_JWKS_PRIVATE_KEY_PATH
ACCESS_REDIS_*
```

Access no usa `@hemia/auth` ni monta login de browser; solo valida Bearer tokens entrantes contra `ACCESS_TRUSTED_ISSUERS`, `ACCESS_EXPECTED_AUDIENCE` e `IDENTITY_JWKS_URI`.

## Migraciones y seeds

```bash
bun run migration:run
bun run seed:run
```

No usar `synchronize: true` ni `migrationsRun: true`; las migraciones y seeds son manuales.

## Tests y build

```bash
bun run test
bun run test:e2e
bun run build
```
