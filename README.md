# Hemia Access

Autorizacion organizacional del ecosistema Hemia: organizations, memberships, roles globales, permisos globales, invitaciones, catalogo tecnico de productos, context tokens, auditoria y outbox.

Access no autentica usuarios ni administra credenciales, sesiones de identidad u OAuth provider. Identity autentica; Access autoriza. Ver [Plan de Migracion Identity + Access](../docs/migracion/plan-migracion-identity-access.md) y [ADR](../docs/ADR/documentoADR.md).

## Apps

| App | Stack | Puerto | README |
|-----|-------|--------|--------|
| [`apps/web`](apps/web) | Next.js 16, React 19, Tailwind v4, shadcn | 3000 | Administracion organizacional |
| [`apps/api`](apps/api) | NestJS 11, TypeORM, PostgreSQL | 3019 | API de Access |

## Responsabilidades

- Validar tokens de Identity para `aud=access-api`.
- Resolver `iss + sub` a identity reference, organizations, memberships, roles y permisos globales.
- Emitir context tokens firmados y exponer JWKS propio.
- Administrar invitations, products y organization-products.
- Publicar eventos con transactional outbox y registrar auditoria organizacional.
- No administrar tenants internos de productos ni permisos locales de producto.

## Requisitos

- [bun](https://bun.sh)
- PostgreSQL

## Arranque

```bash
bun install

bun run dev        # levanta web + api en paralelo
bun run dev:web    # solo frontend (http://localhost:3000)
bun run dev:api    # solo backend  (http://localhost:3019)
```

## Corte por ambiente

El corte se ejecuta despues de Identity. Access requiere el `user_id` del administrador inicial sembrado en Identity para crear la identity reference y membership bootstrap.

```bash
# 1) Identity primero
cd ../identity/backend
bun run migration:run
bun run seed:run

# 2) Access despues
cd ../../access/apps/api
bun run migration:run
bun run seed:run
```

Reglas:

- `synchronize: true` y `migrationsRun: true` estan prohibidos.
- Migraciones y seeds se ejecutan manualmente, nunca en el arranque.
- `/health/ready` queda not ready con `pending_migrations` hasta aplicar migraciones pendientes.
- Los seeds son idempotentes; re-ejecutarlos no debe duplicar orgs, roles, permisos, productos ni bootstrap admin.

## Verificacion minima

- Login admin en Identity con Code + PKCE.
- Token admin `aud=access-api` resuelve contexto con `org_hemia`, `platform_super_admin`, `organization_owner` y productos habilitados.
- Flujo invitation -> login/registro -> membership activa.
- Suspension de membership niega acceso dentro del TTL del context token.
- Outbox y auditoria registran cambios organizacionales.

## Build

```bash
bun run build      # build de todas las apps
```

## Estructura

```
access/
  apps/
    web/   # Next.js (App Router, Tailwind v4, shadcn) — ver apps/web/README.md
    api/   # NestJS (TypeORM, PostgreSQL) — ver apps/api/README.md
  package.json   # workspaces + scripts root
```

Cada app documenta su stack, variables de entorno y comandos en su propio README.
