---
name: backend-architecture
description: Arquitectura, estándares y flujos para el backend NestJS (apps/api). Usar cuando se cree, revise o modifique código en apps/api/, especialmente módulos NestJS, entidades TypeORM, DTOs, servicios, controladores, permisos, migraciones, seeds, base de datos, file upload, auth, configuración o refactors backend.
---

# NestJS Backend Guide (apps/api)

## Objetivo

Trabajar en `apps/api/` siguiendo una arquitectura NestJS + TypeORM + PostgreSQL: módulos
feature-based, DTOs con `class-validator`, permisos por decorator, migraciones TypeORM y
servicios transaccionales cuando hay relaciones o snapshots.

Para detalles completos, leer [references/backend-guide.md](references/backend-guide.md) cuando la
tarea toque arquitectura, entidades, migraciones, permisos, configuración, uploads o revisión.

## Estado Actual vs Objetivo

`apps/api` hoy es un scaffold base (`app.module.ts`, `app.controller.ts`, `app.service.ts`,
`main.ts`). **Aún no tiene** TypeORM, base de datos, auth ni migraciones. La arquitectura de
abajo es el objetivo: scaffolde cada pieza (DatabaseModule, data-source, guards) la primera vez
que un feature la necesite, no antes.

## Mapa Rápido (objetivo)

- App root: `apps/api/src/app.module.ts`
- Entrypoint HTTP: `apps/api/src/main.ts` (escucha `PORT ?? 3001`)
- DB runtime: `apps/api/src/database/database.module.ts` *(crear al añadir TypeORM)*
- TypeORM CLI: `apps/api/data-source.ts` *(crear al añadir migraciones)*
- Migraciones: `apps/api/src/database/migrations/`
- Features: `apps/api/src/modules/<feature>/`
- Entidades: `apps/api/src/modules/<feature>/entities/*.entity.ts`
- DTOs: `apps/api/src/modules/<feature>/dtos/*.dto.ts`
- Mappers: `apps/api/src/modules/<feature>/mappers/*.mapper.ts`
- Guards/decorators: `apps/api/src/common/guards`, `apps/api/src/common/decorators`
- Env schema: `apps/api/src/config/env.validation.ts`

## Workflow Para Cambios Backend

1. Leer el módulo existente más parecido antes de editar.
2. Mantener estructura del feature:
   - `<feature>.module.ts`
   - `<feature>.controller.ts`
   - `<feature>.service.ts`
   - `entities/`
   - `dtos/`
   - `mappers/` si hay DTO complejo o relaciones.
3. Registrar módulos nuevos en `AppModule`.
4. Registrar entidades con `TypeOrmModule.forFeature([...])`.
5. Proteger endpoints con los guards que defina el proyecto (JWT para auth, guard de permisos
   para autorización). Si aún no existen, crearlos en `common/guards` la primera vez.
6. Validar input con DTOs y `ValidationPipe`.
7. Si cambia schema o seed, avisar que requiere migración, pero no generarla ni ejecutarla salvo
   instrucción explícita del usuario.
8. Validación del repo: `bun run --cwd apps/api build`; si toca lógica de negocio, auth,
   permisos, DB queries o guards, también `bun run --cwd apps/api test`.

## Reglas Fuertes

- No leer `process.env` ni `configService.get('DB_HOST')` crudo en services/módulos. Definir
  configs tipadas con `registerAs`, cargarlas en `ConfigModule.forRoot({ load: [...] })` y
  consumirlas namespaced: `configService.get('database.host')`. Ver referencia §3.
- No usar `synchronize: true`; mantener en `false`.
- No modificar DB sin migración.
- No aceptar payloads sin DTO.
- No exponer secretos en endpoints públicos.
- No devolver access/refresh tokens al browser; usar cookies HttpOnly.
- No hard-delete por defecto; preferir soft delete con `DeleteDateColumn`.
- No meter lógica de negocio en controllers.
- No devolver entidades crudas en endpoints públicos/auth o si el módulo ya usa DTO/mappers; usar
  shape explícito o mapper.
- No usar relaciones cascada sin revisar borrado, restore y referencias.
- No agregar permisos nuevos sin actualizar el seed o mecanismo de permisos del proyecto.

## Convenciones Del Proyecto

- Si se añade global prefix (`api/v1`) en `main.ts`, los controllers declaran rutas sin él.
- Permisos: `<resource>.<action>` (`users.read`, `documents.create`), comodines `<resource>.*` y `*.*`.
- UUID primary keys: `@PrimaryGeneratedColumn('uuid')`.
- Columnas DB snake_case vía `name`.
- Propiedades TS camelCase.
- Timestamps: `created_at`, `updated_at`, `deleted_at`.
- JSON flexible: `jsonb`.
- Enums TypeORM para estados/tipos cerrados.
- Índices parciales para unicidad con soft delete.

## Validación Rápida

```bash
bun run --cwd apps/api build
```

Si tocaste service/guard/auth/permisos/queries:

```bash
bun run --cwd apps/api test
```

No generar ni ejecutar migraciones desde esta skill. Si el cambio requiere migración, reportar:
"requiere migración manual". El usuario la crea/ejecuta.
