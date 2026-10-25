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

bun run dev        # inicia web; ejecutar dev:api en otra terminal
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
- El seed solo inserta catálogos faltantes; conserva todos los campos y estados existentes. La matriz de permisos se asigna solo a roles nuevos y el bootstrap de identidad, membresía, roles y accesos de Hemia se crea solo con la organización inicial. Reejecutarlo no restaura relaciones retiradas ni reactiva accesos.
- Los roles de sistema de Billing/Legal y sus concesiones siguen en los comandos de bootstrap explícitos; el seed general no los reconfigura.

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

## Releases y despliegue

CI, Changesets, imagenes en registry privado y deploy por Tailscale/SSH estan
documentados en [CI/CD de Access](docs/access-ci-cd.md). API y panel comparten
version: tag `access-vX.Y.Z`, Release `Access X.Y.Z`. `bun run check` ejecuta las
validaciones y el smoke Docker con dependencias desechables.

## Estructura

```
access/
  apps/
    web/   # Next.js (App Router, Tailwind v4, shadcn) — ver apps/web/README.md
    api/   # NestJS (TypeORM, PostgreSQL) — ver apps/api/README.md
  package.json   # workspaces + scripts root
```

Cada app documenta su stack, variables de entorno y comandos en su propio README.

## Retiro de Workload Access — 2026-10-20

El backend y las tablas de Workload Access fueron retirados del perfil vigente.
La autenticación M2M usa OAuth client_credentials por servicio, audiencia y scopes.
Los roles/permisos normales de personas permanecen.

## Pruebas y estructura de módulos

Todas las pruebas están en [`test/`](test/README.md). Ejecutar `bun run test` desde esta raíz. Los módulos conservan su archivo `*.module.ts` como entrada y agrupan sus responsabilidades repetidas en subcarpetas: caché, JWKS y autorización en Access Context; catálogos, DTOs, autorización e historial en System Roles; transporte y aprovisionamiento en Event Bus.

## Observabilidad

La integración de producción con HORUS sigue pendiente: contrato de transporte/autenticación, métricas, umbrales y validación de alertas. El laboratorio local de Prometheus/Alertmanager, sus pruebas y su runner de carga dependían del paquete de métricas retirado y fueron eliminados.
