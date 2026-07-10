# API (NestJS)

Backend del monorepo `nextjs-nestjs`. Plantilla NestJS + TypeORM + PostgreSQL.
La base de datos viene **desactivada** hasta que la configures (ver abajo).

## Stack

- **NestJS 11** — framework HTTP (módulos, controllers, services).
- **TypeORM** — ORM + migraciones contra PostgreSQL.
- **PostgreSQL** — base de datos (timezone `America/Mexico_City`).
- **@nestjs/config** — configuración tipada por namespace (`registerAs`).
- **class-validator / class-transformer** — validación de DTOs vía `ValidationPipe` global.
- **TypeScript**, **Jest** (tests), **ESLint + Prettier**.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/api/
  data-source.ts                 # DataSource para el CLI de migraciones
  src/
    main.ts                      # bootstrap: ValidationPipe global + CORS, escucha PORT (3001)
    app.module.ts                # módulo raíz (DatabaseModule/WidgetsModule comentados hasta tener DB)
    config/
      database.config.ts         # config namespaced 'database' (registerAs)
    database/
      database.module.ts         # TypeOrmModule.forRootAsync, synchronize: false
      migrations/                # migraciones TypeORM
    modules/
      widgets/                   # módulo dummy de ejemplo (controller, service, entity, dtos)
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
DB_LOGGING=false
```

`PORT` opcional (default `3001`). `.env` y `.env.local` están en `.gitignore`.

## Arranque

```bash
bun install
bun run --cwd apps/api start:dev   # watch mode
```

Sin DB el servidor levanta igual (responde en `/`). El módulo de datos está apagado.

## Activar la base de datos

1. Completa `.env`.
2. En `src/app.module.ts` descomenta los imports de `DatabaseModule` y `WidgetsModule`.
3. Genera y corre la migración:

```bash
bun run --cwd apps/api migration:generate src/database/migrations/CreateWidgets
bun run --cwd apps/api migration:run
```

## Migraciones

```bash
bun run --cwd apps/api migration:generate src/database/migrations/<Nombre>
bun run --cwd apps/api migration:run
bun run --cwd apps/api migration:revert
```

`synchronize` está en `false`: todo cambio de schema requiere migración.

## Tests y build

```bash
bun run --cwd apps/api test
bun run --cwd apps/api build
```
