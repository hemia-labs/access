# Modo temporal de autorización

`HEMIA_AUTHORIZATION_MODE=roles` es el valor predeterminado. `authenticated`
permite las acciones humanas sin comprobar roles, tanto en desarrollo como en
producción. Activar el mismo valor en Access, Console, Legal y Billing y recrear
sus backends; no hay migraciones ni asignaciones automáticas de roles.

La sesión, identidad activa, membresías vigentes, producto habilitado, contrato y
firma de contexto, separación por organización y validaciones de negocio siguen
aplicando. Las cuentas de servicio conservan sus políticas. Los operadores de
catálogos globales requieren su membresía interna activa, pero ningún rol.

En este modo los contextos Billing/Legal tienen `assignments: []`; son contratos
firmados de membresía, no roles sintéticos. Las aplicaciones derivan sus acciones
del modo configurado. La configuración global de los sistemas sigue siendo una
acción administrativa permitida en este modo.

Para restaurar controles: cambiar el valor a `roles` en los cuatro entornos y
recrear backends. No se revocan ni deshacen las acciones realizadas mientras el
modo temporal estuvo activo. Conservar el valor `roles` en ejemplos y defaults.

## Activación aislada de Billing

En Access, `HEMIA_BILLING_AUTHORIZATION_MODE=roles` cambia únicamente el
descubrimiento de organizaciones y los contextos firmados de Billing. Si está
ausente o vacío, hereda `HEMIA_AUTHORIZATION_MODE`. No cambia la autorización de
Legal, Console, la administración de Access ni las cuentas de servicio. Los dos
valores válidos son `roles` y `authenticated`; cualquier otro impide iniciar
Access. El consumidor Billing debe activar también su modo `roles` y aceptar
catálogos 1 y 2 antes de habilitar el override en Access.

No cambiar el modo global para habilitar solo Billing. Una sesión o contexto ya
emitido puede conservarse hasta su vencimiento; comprobar el resultado con una
nueva resolución de contexto y una sesión renovada del consumidor.

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
`organization_owner` por sí solos no conceden esa autoridad en modo `roles`.
El listado de catálogos devuelve los IDs de roles de las versiones publicadas.
Las asignaciones directas de Billing y Legal y la gestión de roles de plataforma
requieren `platform_super_admin` también en modo `authenticated`.
Console usa las asignaciones de sistema para conservar la auditoría y la
validación de Access.

`GET /v1/system-roles/assignments?membershipId=<uuid>` devuelve las
asignaciones registradas y sin vencer de una membresía, incluidos su alcance,
vigencia y versión para revocar. La consulta requiere `platform_super_admin`.
El catálogo expone los códigos de permiso para el formulario. Los sistemas
consumidores siguen aplicando su mapa de permisos de la versión publicada.

Preparar primero consumidores compatibles, publicar v2 y asignar explícitamente
los operadores que conservarán acceso; después activar el modo Billing aislado
y comprobar que un usuario sin asignación no puede resolver contexto Billing.
Las asignaciones v1 siguen funcionando y no necesitan recrearse.
