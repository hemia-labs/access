# Hemia Access API

Backend NestJS de Hemia Access. Administra organizations, memberships, roles/permisos globales, invitations, product access, context tokens, auditoria y outbox.

Los JWT de usuario se autorizan con memberships y roles activos. Los JWT de servicio se reconocen por `grant_type: client_credentials` después de validar su firma RS256, issuer y audience `access-api`. Requieren `typ: at+jwt`, `kid`, `sub` igual a `client_id`, `scope`, `jti`, `iat` y `exp`, con vigencia máxima de 600 segundos. Se introspectan contra Identity para comprobar revocación y se autorizan por scope como `service_account`; Console usa el cliente `console-access-admin`. Los tokens opacos conservan la validación por introspección.

Una referencia existente debe tener el mismo tipo que la identidad verificada, incluida la recuperación de inserciones concurrentes. Una discrepancia devuelve `401 ACCESS_IDENTITY_TYPE_MISMATCH`; requiere revisar el registro antes de corregirlo, sin convertir automáticamente usuarios en servicios.

Access no ejecuta login de usuario. Recibe tokens emitidos por Hemia ID o Customer Registry, los valida contra JWKS allowlisted y resuelve contexto organizacional.

## Configuracion

La API y los comandos de migraciones, seeds y bootstrap cargan `.env.production`
si `NODE_ENV=production`; en desarrollo cargan `.env.local`. Los archivos se
buscan desde `apps/api`, sin mezclar valores de otros archivos `.env`.
Las variables ya definidas en el entorno tienen prioridad. `NODE_ENV` debe
definirse antes de iniciar el proceso; `start:prod` lo establece en `production`.

`src/config/access.config.ts` contiene toda la configuracion de Access, incluida la validacion de tokens entrantes:

```txt
PORT
ACCESS_ISSUER
ACCESS_EXPECTED_AUDIENCE
ACCESS_TRUSTED_ISSUERS
IDENTITY_JWKS_URI
IDENTITY_ISSUER
IDENTITY_INTROSPECTION_URL
IDENTITY_INTROSPECTION_CLIENT_ID
IDENTITY_INTROSPECTION_CLIENT_SECRET
ACCESS_CONTEXT_TOKEN_TTL_SECONDS
ACCESS_CONTEXT_CACHE_TTL_SECONDS
ACCESS_JWKS_KEY_KID
ACCESS_JWKS_PRIVATE_KEY_PATH
ACCESS_REDIS_*
```

Access no usa `@hemia/auth` ni monta login de browser; solo valida Bearer tokens entrantes contra `ACCESS_TRUSTED_ISSUERS`, `ACCESS_EXPECTED_AUDIENCE` e `IDENTITY_JWKS_URI`.

Desplegar primero esta validación de Access, después la emisión JWT de Identity y finalmente obtener nuevos tokens de servicio. Los tokens para Access usan `aud: access-api`; los consumidores de Billing solicitan tokens con `aud: billing-api` mediante sus clientes dedicados. Esta actualización de Access no requiere cambios de esquema, migraciones ni seeds.

## Migraciones y seeds

```bash
bun run migration:run
bun run seed:run
```

No usar `synchronize: true` ni `migrationsRun: true`; las migraciones y seeds son manuales.

## Tests y build

```bash
bun run test
bun run build
```

Las pruebas están centralizadas en `access/test/`. Para ejecutarlas y agregar cobertura, consulta [`test/README.md`](../../test/README.md).

## Retiro de Workload Access — 2026-10-20

El backend y las tablas de Workload Access fueron retirados del perfil vigente.
La autenticación M2M usa OAuth client_credentials por servicio, audiencia y scopes.
Los roles/permisos normales de personas permanecen.

## Dependencias publicadas

El bus de eventos usa `@hemia/event-bus` 0.0.3 desde npm. No se usan paquetes de vendor ni referencias a repositorios locales.

Los paquetes no publicados de métricas y policy-core fueron retirados. No hay listener de métricas, workers WASM ni módulos de policies administradas, planes o autorización por Rust. La suspensión de memberships usa el permiso RBAC `membership.suspend`, conserva la protección de organizaciones internas y genera auditoría, outbox e invalidación de contexto. Readiness comprueba PostgreSQL, migraciones pendientes y Redis.

Las tablas de policies y sus credenciales técnicas se eliminaron directamente de las bases feature, con respaldo previo y sin migraciones nuevas. El historial de migraciones aplicadas se conserva en la BD. Consulta [el estado de las migraciones](src/database/migrations/README.md).
