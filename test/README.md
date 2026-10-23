# Pruebas de Access

Todas las pruebas viven en `access/test/`. No agregar archivos de prueba a `src/`, a `scripts/` ni a los módulos.

## Estructura

- `api/unit/`: pruebas unitarias de la API, organizadas por módulo; incluye `activate-billing.test.mjs`.
- `api/integration/`: Redis desechable y contexto de Console con PostgreSQL desechable.
- `api/acceptance/`: preparación, aceptación, delegaciones y recuperación de broker de Billing sobre un entorno preparado.

## Ejecución habitual

Desde la raíz `access/`, `bun run test` ejecuta Jest y la prueba del script de activación. Desde `apps/api`, `bun run test --runInBand` ejecuta Jest, `bun run test:activation` ejecuta las pruebas de activación y `bun run test:typecheck` comprueba los tipos. Jest usa `test/tsconfig.json`, encuentra las pruebas `*.spec.ts` bajo `test/api/` y mide cobertura del código en `apps/api/src/`.

La integración Redis está deshabilitada salvo `HEMIA_REDIS_RECOVERY_TEST=1`; necesita `redis-server` y usa un proceso aislado sin persistencia.

`bun run test:console-context`, desde `apps/api`, valida el contexto de Console con tablas TEMP en PostgreSQL desechable. Requiere Docker activo y la imagen local `postgres:18`. No ejecuta migraciones/seeds ni lee credenciales del entorno. Publica únicamente en loopback y elimina el contenedor al finalizar. Comprueba los joins y filtros SQL reales, las revocaciones y la expiración del JWT de [ConsoleAuthorizationService](../apps/api/src/modules/access-context/authorization/console-authorization.service.ts); las pruebas unitarias simulan esa consulta y no reemplazan esta integración. Console consume este contexto firmado en cada comprobación administrativa.

Los scripts de `api/acceptance/` son manuales: requieren sus servicios, cuentas sintéticas y configuración explícita. Algunos escriben datos, reinician procesos o provocan desconexiones; no forman parte de `bun run test` y no deben ejecutarse contra producción.

El preparador requiere `HEMIA_ADMIN_SESSION_FILE` y `HEMIA_ACCEPTANCE_STATE_FILE` fuera del repositorio. Crea cuatro organizaciones, trece usuarios, los once casos de rol/alcance y una concesión adicional para selección multiorganización. Ejecutar después `test-billing-acceptance.cjs`, `test-billing-delegations.cjs` y `test-billing-advanced.cjs --isolation`. Para `--refresh`, iniciar una segunda instancia de Billing con el mismo Redis y callback y esperar el vencimiento real del access token de quince minutos. `test-billing-broker-recovery.cjs` requiere `HEMIA_ALLOW_BACKEND_RESTART=1` y detiene/reinicia las APIs locales de Access y Billing; debe ejecutarse exclusivamente en un entorno desechable.

## Pruebas nuevas

Agregar unitarias a `api/unit/` e integraciones a `api/integration/`, conservando subcarpetas por módulo. Las integraciones de BD deben usar PostgreSQL desechable y datos sintéticos; no leer `.env` ni apuntar a las bases configuradas. Las migraciones/seeds, si una integración los necesita, se ejecutan explícitamente en la base temporal, nunca en el arranque de la aplicación. Limpiar procesos y contenedores incluso si falla la prueba.

Las antiguas suites de migraciones e historial, bootstrap, E2E y benchmarks retiradas no se recuperan mediante este movimiento. Los README de módulos conservan sus descripciones históricas; el benchmark y su documento de rendimiento fueron retirados.

## Seed sin sobrescrituras

Desde `apps/api`, `bun run test:seed:docker` compila y usa PostgreSQL desechable, sin leer `.env`. Ejecuta las migraciones explícitamente y prueba el seed desde cero contra el catálogo verificado (16 permisos, 10 roles, 55 relaciones y 11 productos base). Compara todas las filas y timestamps al repetirlo y después de personalizar datos, desactivar accesos y retirar relaciones y la membresía inicial. Comprueba que no se restauran los permisos/policies eliminados ni los accesos revocados. El contenedor y volumen se eliminan al terminar.
