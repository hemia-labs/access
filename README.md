# nextjs-nestjs

Monorepo con **Next.js** (frontend) y **NestJS** (backend), gestionado con **bun workspaces**.

## Apps

| App | Stack | Puerto | README |
|-----|-------|--------|--------|
| [`apps/web`](apps/web) | Next.js 16, React 19, Tailwind v4, shadcn | 3000 | [ver](apps/web/README.md) |
| [`apps/api`](apps/api) | NestJS 11, TypeORM, PostgreSQL | 3001 | [ver](apps/api/README.md) |

> La base de datos del backend viene **desactivada** hasta configurarla. Detalles en el README de `apps/api`.

## Requisitos

- [bun](https://bun.sh)
- PostgreSQL (solo cuando actives la DB del backend)

## Arranque

```bash
bun install

bun run dev        # levanta web + api en paralelo
bun run dev:web    # solo frontend (http://localhost:3000)
bun run dev:api    # solo backend  (http://localhost:3001)
```

## Build

```bash
bun run build      # build de todas las apps
```

## Estructura

```
nextjs-nestjs/
  apps/
    web/   # Next.js (App Router, Tailwind v4, shadcn) — ver apps/web/README.md
    api/   # NestJS (TypeORM, PostgreSQL) — ver apps/api/README.md
  package.json   # workspaces + scripts root
```

Cada app documenta su stack, variables de entorno y comandos en su propio README.
