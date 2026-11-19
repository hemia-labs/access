# Autorización obligatoria por roles

`HEMIA_AUTHORIZATION_MODE=roles` es el único modo permitido y el valor
predeterminado en Access. El antiguo override
`HEMIA_BILLING_AUTHORIZATION_MODE` puede omitirse o valer `roles`.
`authenticated` y cualquier valor desconocido impiden iniciar el backend con
un error que identifica la variable. No existe una ruta de autorización por
el mero hecho de iniciar sesión.

La administración de Access aplica permisos de roles vigentes por organización
o de plataforma. Las acciones de plataforma requieren la autoridad
`platform_super_admin` correspondiente. Crear una organización o tener una
membresía interna no concede esos privilegios.

Billing y Legal descubren organizaciones y reciben contextos firmados sólo
mediante asignaciones de sistema efectivas. Access conserva sus roles,
alcances, versión de catálogo y fechas de vigencia; no fabrica permisos ni
firma contextos con asignaciones vacías. Console conserva su contrato de
administración con rol de plataforma y permiso global explícitos. La identidad,
membresía y producto deben seguir activos, y las delegaciones deben permanecer
vigentes y cubrir el alcance solicitado. Las políticas de cuentas de servicio
no cambian.

El despliegue fija explícitamente `roles` en Access y sus consumidores. Comprobar
las asignaciones explícitas de cada operador. El despliegue no crea roles para
usuarios, no asigna permisos y no ejecuta migraciones ni seeds. No revoca ni
deshace acciones realizadas durante el modo temporal.

Después del despliegue, renovar la sesión del consumidor y resolver un contexto
nuevo: un token ya firmado puede seguir vigente hasta su vencimiento. Las
resoluciones nuevas consultan la autoridad actual y rechazan asignaciones
revocadas o vencidas. Comprobar que un usuario sin roles recibe una denegación
y que un operador de lectura sólo obtiene el alcance y acciones de su rol.

## Catálogo Billing v2 y consulta de webhooks

El catálogo v1 permanece inmutable. V2 conserva sus seis roles y añade
`billing.webhook_viewer` (Consulta de webhooks), cuyo único alcance es
`all_customers`. Conserva `contract_version: 1` y el perfil `billing_v1`; no
requiere migración de esquema ni actualiza asignaciones anteriores. Access
firma `catalog_version: 1` para asignaciones efectivas v1 y `2` cuando al menos
una asignación efectiva usa v2. Publicar v2 no eleva la versión de un usuario
sin asignaciones v2.

Un administrador autorizado puede publicar explícitamente mediante
`POST /v1/system-roles/catalogs/billing/v2` con `{}`. La publicación es
idempotente y no asigna roles. `GET /v1/system-roles/catalogs` incluye ambas
versiones y su estado. Hemia Console muestra la versión más reciente en
`/es/access/system-role-catalogs` y construye la ruta de publicación con esa
versión; no necesita un endpoint v2 codificado en su interfaz.

La asignación es una operación distinta: `POST /v1/system-roles/assignments`,
con `roleId` devuelto al publicar v2, la membresía destinataria, `scopeType:
"all_customers"`, `organizationIds: []`, fechas e `idempotencyKey` de acuerdo
con el contrato existente. Usar la autoridad `platform_super_admin` vigente
para publicación y asignación global; `organization_admin` o
`organization_owner` por sí solos no conceden esa autoridad.
El listado de catálogos devuelve los IDs de roles de las versiones publicadas.
Las asignaciones directas de Billing y Legal y la gestión de roles de plataforma
requieren `platform_super_admin`.
Console usa las asignaciones de sistema para conservar la auditoría y la
validación de Access.

`GET /v1/system-roles/assignments?membershipId=<uuid>` devuelve las
asignaciones registradas y sin vencer de una membresía, incluidos su alcance,
vigencia y versión para revocar. La consulta requiere `platform_super_admin`.
El catálogo expone los códigos de permiso para el formulario. Los sistemas
consumidores siguen aplicando su mapa de permisos de la versión publicada.

Preparar primero consumidores compatibles, publicar v2 y asignar explícitamente
los operadores que conservarán acceso; después desplegar la autorización por
roles en todos los productos y comprobar que un usuario sin asignación no puede resolver contexto Billing.
Las asignaciones v1 siguen funcionando y no necesitan recrearse.
