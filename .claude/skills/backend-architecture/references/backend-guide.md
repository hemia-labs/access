# NestJS Backend Guide (apps/api)

## Índice

- [1. Stack Y Filosofía](#1-stack-y-filosofía)
- [2. Estructura Principal](#2-estructura-principal)
- [3. Base De Datos](#3-base-de-datos)
- [4. Entidades TypeORM](#4-entidades-typeorm)
- [5. Módulos](#5-módulos)
- [6. Controllers](#6-controllers)
- [7. Services](#7-services)
- [8. DTOs](#8-dtos)
- [9. Mappers](#9-mappers)
- [10. Permisos Y Auth](#10-permisos-y-auth)
- [11. Migraciones Y Seeds](#11-migraciones-y-seeds)
- [12. Configuración Dinámica](#12-configuración-dinámica)
- [13. Archivos Y Uploads](#13-archivos-y-uploads)
- [14. Anti-patterns A Evitar](#14-anti-patterns-a-evitar)
- [15. Estándares Para Nuevos Features](#15-estándares-para-nuevos-features)
- [16. Validación Final](#16-validación-final)

> `apps/api` arranca como scaffold base (sin TypeORM/DB/auth). Scaffolde cada pieza la primera
> vez que un feature la necesite; esta guía es el objetivo, no estado actual.

## 1. Stack Y Filosofía

Backend NestJS con TypeORM, PostgreSQL, JWT/auth, cookies opcionales, `class-validator`,
`class-transformer`, Joi para env y storage compatible con S3 cuando aplique.

Arquitectura: módulos por dominio en `apps/api/src/modules`. Cada feature encapsula controller,
service, entities, DTOs y mapper cuando aplica. Controller expone HTTP; service contiene reglas de
negocio; entities modelan DB; DTOs validan request/response.

Principio: seguir patrones existentes antes de inventar abstracciones.

## 2. Estructura Principal

```text
apps/api/
  data-source.ts
  package.json
  src/
    app.module.ts
    main.ts
    config/
      env.validation.ts
    database/
      database.module.ts
      migrations/
    common/
      decorators/
      guards/
      utils/
    modules/
      <feature>/
        <feature>.module.ts
        <feature>.controller.ts
        <feature>.service.ts
        dtos/
        entities/
        mappers/
```

`app.module.ts` importa `ConfigModule`, `DatabaseModule` y módulos funcionales. Módulo nuevo debe
registrarse ahí si expone endpoints o providers usados por la app.

`main.ts` crea app Nest, activa middleware global, CORS, cookies si aplica y escucha `PORT` (3001).

## 3. Configuración Tipada (registerAs + load)

**Regla estricta:** nunca leer `process.env.X` ni `configService.get('DB_HOST')` crudo en módulos
o services. Cada dominio define un config namespaced con `registerAs`, se carga en
`ConfigModule.forRoot({ load: [...] })`, y se consume por namespace: `configService.get('database.host')`.

Configs viven en `apps/api/src/config/`. Una por dominio:

```ts
// config/database.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  name: process.env.DB_DATABASE,
  logging: process.env.DB_LOGGING === 'true',
}));
```

`AppModule` carga todas las configs y valida env (Joi) antes de `DatabaseModule`:

```ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [appConfig, databaseConfig, authConfig],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### Configs mínimas sugeridas

| Namespace | Claves | Para qué |
|---|---|---|
| `app` | `port`, `nodeEnv`, `globalPrefix`, `corsOrigins` | bootstrap, CORS, prefix |
| `database` | `host`, `port`, `username`, `password`, `name`, `logging` | conexión TypeORM |
| `auth` | `jwtSecret`, `jwtExpiresIn`, `refreshSecret`, `refreshExpiresIn`, `cookieSecure` | JWT/cookies (al añadir auth) |

Añadir más namespaces (`storage`, `mail`, `redis`, etc.) solo cuando un feature los necesite.

### Base De Datos

Runtime DB en `src/database/database.module.ts`, leyendo el namespace `database`:

- `TypeOrmModule.forRootAsync` con credenciales desde `ConfigService` (namespaced).
- DB: `postgres`. Entidades por glob `**/*.entity.ts/js`. `synchronize: false`.
- Logging desde config (no `true` fijo en prod). Timezone vía `extra.options` si el proyecto lo necesita.

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        logging: config.get<boolean>('database.logging'),
        entities: [
          path.join(__dirname, '..', '**', '*.entity.ts'),
          path.join(__dirname, '..', '**', '*.entity.js'),
        ],
        synchronize: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

Variables `.env` esperadas:

```text
DB_HOST=
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
DB_LOGGING=false
```

CLI de migraciones en `data-source.ts` (separado de `DatabaseModule` porque TypeORM CLI instancia
`DataSource` fuera del ciclo de NestJS). Es la **única** excepción a la regla de no usar
`process.env` crudo: aquí no hay `ConfigService` disponible.

```ts
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const isProduction = process.env.NODE_ENV === 'production';
const ext = isProduction ? 'js' : 'ts';
const baseDir = isProduction ? 'dist' : 'src';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [path.join(process.cwd(), `${baseDir}/**/*.entity.${ext}`)],
  migrations: [path.join(process.cwd(), `${baseDir}/database/migrations/*.${ext}`)],
});
```

No cambiar DB manualmente sin reflejarlo en migración. Desde esta skill no generar ni ejecutar
migraciones salvo instrucción explícita; indicar que el cambio requiere migración manual.

## 4. Entidades TypeORM

Ubicación: `apps/api/src/modules/<feature>/entities/*.entity.ts`.

```ts
@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
```

Convenciones:

- Tabla en plural snake_case: `resources`, `resource_items`.
- Propiedades TS camelCase: `resourceId`.
- Columnas DB snake_case: `@Column({ name: 'resource_id' })`.
- UUID FK explícita + relación:

```ts
@Column({ name: 'resource_id', type: 'uuid' })
resourceId: string;

@ManyToOne(() => Resource, { onDelete: 'RESTRICT' })
@JoinColumn({ name: 'resource_id' })
resource: Resource;
```

Usar `jsonb` para valores flexibles, metadata o payloads semi-estructurados.

Índices cuando hay búsquedas frecuentes por estado/slug/FK, o unicidad con soft delete:

```ts
@Index('IDX_resources_slug_active_unique', ['slug'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
```

Evitar: `synchronize: true`; `varchar` sin length para datos conocidos; hard delete por defecto si
hay soft delete; relaciones bidireccionales que no se consultan.

## 5. Módulos

```ts
@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([Resource])],
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
```

Exportar service solo si otros módulos lo usan. Si un service necesita entidades de otros módulos,
registrarlas en `forFeature` del módulo actual o importar el módulo que exporta el service.

## 6. Controllers

Ubicación: `apps/api/src/modules/<feature>/<feature>.controller.ts`.

```ts
@Controller('resources')
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(JwtAuthGuard)
export class ResourcesController {
  constructor(private readonly service: ResourcesService) {}

  @Get()
  @Permissions('resources.view')
  async findAll(@Query(new ValidationPipe({ transform: true })) query: FilterResourceDto) {
    return this.service.findAll(query);
  }
}
```

Reglas:

- Controller no contiene lógica de negocio; valida DTOs y delega.
- Rutas públicas en controller separado o endpoint explícitamente diseñado.
- Ordenar rutas específicas antes de `:id`: `slug/:slug`, `:id/history`, luego `:id`.
- `@HttpCode(HttpStatus.NO_CONTENT)` cuando no se devuelve body.

## 7. Services

Services contienen: queries TypeORM, validaciones de existencia/unicidad, transacciones,
sincronización de relaciones, errores de dominio.

Errores esperados: `NotFoundException`, `ConflictException`, `BadRequestException`,
`ForbiddenException`, `UnauthorizedException`.

```ts
private async ensureExists(id: string, withDeleted = false): Promise<Resource> {
  const entity = await this.repository.findOne({ where: { id }, withDeleted });
  if (!entity) throw new NotFoundException('Resource not found');
  return entity;
}
```

Usar transacción cuando una operación crea/actualiza varias tablas, crea snapshots/versiones,
sincroniza many-to-many, sube archivos y luego crea registros, o actualiza datos que deben quedar
consistentes juntos.

## 8. DTOs

Ubicación: `apps/api/src/modules/<feature>/dtos/*.dto.ts`. Usar `class-validator`:

```ts
export class CreateResourceDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  name: string;
}
```

Reglas:

- create: campos requeridos. update: campos opcionales.
- filter: query params opcionales con `ValidationPipe({ transform: true })`.
- response: shape público; no passwords, hashes ni secrets.
- Mensajes en el idioma del proyecto.

Evitar: aceptar `any`; `unknown` sin validar en service; exponer entidades con relaciones sensibles.

## 9. Mappers

Usar `mappers/` cuando el response DTO no coincide 1:1 con entity, hay relaciones a resumir, campos
sensibles o formateo de snapshots.

```ts
export class ResourceMapper {
  static toDTO(entity: Resource): ResourceDto { /* ... */ }
  static toEntity(dto: CreateResourceDto): Resource { /* ... */ }
  static toUpdateEntity(dto: UpdateResourceDto): Partial<Resource> { /* ... */ }
}
```

Para módulos simples se puede mapear en el service; si crece, extraer mapper.

## 10. Permisos Y Auth

Patrón: decorator `@Permissions(...)`, guard JWT para autenticación, guard de autorización para
permisos. Wildcards: `*.*`, `<resource>.*`, permiso exacto `<resource>.view`.

Al agregar endpoint nuevo:

1. Definir permiso en controller.
2. Agregar permiso al seed o mecanismo de permisos del proyecto.
3. Agregar permiso a roles/perfiles si aplica.
4. Validar frontend con el mismo permiso si hay UI (mismatch → botón que da 403).

Naming: `<resource>.view`, `.create`, `.edit`, `.delete`, `.restore`; extra: `.publish`,
`.approve`, `.export`.

## 11. Migraciones Y Seeds

Migraciones en `apps/api/src/database/migrations/`. Comandos solo si el usuario lo pide
explícitamente; no ejecutarlos automáticamente. Requieren scripts en `apps/api/package.json` que
apunten a `data-source.ts`:

```bash
bun run --cwd apps/api migration:generate
bun run --cwd apps/api migration:run
bun run --cwd apps/api migration:revert
```

Reglas:

- Toda entity nueva o cambio de columna requiere migración manual.
- Seeds base pueden vivir en migraciones si forman parte del estado inicial requerido.
- Seeds idempotentes con `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE`.
- En `down`, revertir lo insertado si es razonable y seguro.

No: editar migración ya aplicada en ambientes compartidos sin acordarlo; mezclar schema + seed
enorme; borrar datos de usuario en `down` salvo seeds conocidos.

## 12. Configuración Dinámica

Para config editable desde admin/API, tabla key/value solo si el dominio lo justifica:

- `key` único y estable. `value` `jsonb`. `type` (`text`/`number`/`boolean`/`array`/`json`).
- `group` agrupación. `isPublic` si puede exponerse. `isReadonly` si solo cambia por seed/migración.

Reglas: secrets nunca públicos; endpoint público filtra por `isPublic`; validar `value` contra
`type` en service; bloquear update si `isReadonly`.

## 13. Archivos Y Uploads

Separar metadata del archivo (DB), objeto binario (storage) y referencias desde otras entidades.

Storage: local, S3 compatible o proveedor externo.

Reglas:

- Metadata: filename, originalName, mimeType, size, storageKey, url, uploader.
- No borrar archivo si está referenciado.
- `hardDelete` elimina objeto remoto si existe `storageKey`.
- `delete` normal hace soft-delete cuando el dominio requiere recuperación.
- Upload scope explícito si hay distintos contextos.

## 14. Anti-patterns A Evitar

- Permisos inconsistentes entre backend y frontend.
- Logging TypeORM siempre activo en producción.
- Lógica de negocio en controllers.
- Mappers en unos módulos y mapping inline en otros sin criterio.
- Responses con entities crudas y relaciones sensibles.
- Migraciones/seeds enormes o mezcladas.
- Services críticos sin tests.
- DTOs con JSON flexible sin validación posterior.
- Hard delete sin verificar referencias.

## 15. Estándares Para Nuevos Features

1. Crear `apps/api/src/modules/<feature>/`.
2. Entity con UUID, timestamps y soft delete si aplica.
3. DTOs `create`, `update`, `filter`, response.
4. Mapper si el response no es trivial.
5. Service con repository inyectado.
6. Controller `<resource>`.
7. Permisos si el endpoint es privado.
8. Module con `TypeOrmModule.forFeature`.
9. Registrar module en `AppModule`.
10. Indicar migración manual si cambió schema/seed.
11. Ejecutar build.

```ts
@Get()    @Permissions('widgets.view')
@Post()   @Permissions('widgets.create')
@Put(':id')   @Permissions('widgets.edit')
@Delete(':id') @Permissions('widgets.delete')
```

## 16. Validación Final

```bash
bun run --cwd apps/api build
```

Si hay lógica crítica (service/guard/auth/permisos/queries):

```bash
bun run --cwd apps/api test
```

No ejecutar migraciones. Si hay cambio de schema/seed, reportar que requiere migración manual.

En la respuesta final mencionar: archivos tocados, si requiere migración manual, comandos
ejecutados, y limitaciones (DB no disponible, tests inexistentes, errores previos).
