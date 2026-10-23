# Elegibilidad interna

`organization.type === 'internal'` identifica organizaciones elegibles para operar sistemas internos. No concede roles de sistema. La clasificación y la administración de organizaciones internas requieren un administrador de plataforma verificado en Access.

## Operaciones

- `POST /v1/organizations`: crear una organización `internal` exige un `platform_super_admin` global activo. La creación de otros tipos conserva el permiso de plataforma del controlador.
- `PATCH /v1/organizations/:organizationId`: rechaza `type`, incluso cuando el actor es administrador de plataforma. El servicio escribe una lista explícita de campos ordinarios.
- `PATCH /v1/organizations/:organizationId/classification`: cambia la clasificación en ambas direcciones; recibe `{ "type": "internal", "version": 2 }`. Exige autoridad de plataforma en el servicio y versión coincidente; devuelve 409 ante versión obsoleta. La versión corresponde a la organización.
- Actualizar, suspender, activar o archivar una organización interna exige también esa autoridad. La membresía organizacional o un scope de cuenta de servicio no la sustituyen.
- Crear, actualizar o cambiar estado de membresías internas, administrar sus roles y emitir, reenviar o revocar invitaciones internas exige esa autoridad.
- Aceptar una invitación interna verifica de nuevo la autoridad vigente de quien la emitió y que la organización esté activa. El invitado no necesita ser administrador.
- Las invitaciones solo conceden roles organizacionales activos, tanto al crearlas como al aceptarlas. Los roles de plataforma se asignan por la operación explícita de asignación de roles, protegida en el servicio; tampoco pueden introducirse libremente mediante `role_codes` al crear membresías.
- Un endpoint organizacional no puede crear roles con `scope: platform`. Las asignaciones por ID rechazan roles de otra organización.

La autoridad exige identidad activa, membresía activa y no vencida en una organización interna activa, y asignación vigente del rol global activo `platform_super_admin` con `scope: platform`. No se deduce de nombres, correos, claims o permisos organizacionales. Las cuentas de servicio no pueden ejercer estas operaciones protegidas con sus scopes. El bootstrap existente por seed sigue siendo una operación explícita de despliegue; no se ha ejecutado ni se ejecuta en el arranque.

## Consistencia e invalidación

Las comprobaciones protegidas ocurren dentro de la transacción que escribe. Se bloquea la organización para impedir cambios de clasificación durante la operación y se mantienen bloqueos compartidos sobre la autoridad consultada. Conflictos de bloqueo o serialización deben abortar la operación; no se continúa con una autorización anterior.

Cambiar clasificación incrementa la versión organizacional y los `context_version` de sus membresías, registra auditoría del antes/después y eventos outbox de elegibilidad e invalidación por membresía dentro de la misma transacción. Suspender, activar y archivar también incrementa las versiones de contexto y registra invalidaciones. Una clasificación sin cambios no produce una nueva versión.

Después del commit se eliminan las entradas de caché de las identidades afectadas. Si Redis falla, la operación puede haber quedado confirmada: consultar la organización antes de reintentar; su versión evita sobrescribirla. Los eventos quedan persistidos para su entrega por outbox.

Esto no revoca por sí mismo JWT ya emitidos ni implementa el futuro consumidor de invalidaciones de Billing. El emisor/SDK y las asignaciones derivadas de delegaciones se conectan en la siguiente etapa del contrato; no se ofrece revocación inmediata por borrar Redis.

## Permisos y verificación

El seed usa una lista explícita de permisos organizacionales para `organization_owner`; ampliar el catálogo de plataforma no los incorpora automáticamente. No se han aplicado seeds ni cambios a datos existentes.

Las pruebas unitarias cubren cambios en ambas direcciones, rechazo de la ruta genérica, creación interna, autoridad insuficiente, concurrencia optimista, auditoría/outbox, invalidación posterior al commit, protección de membresías y rechazo de escalación por roles e invitaciones. No sustituyen pruebas de bloqueo o migraciones contra PostgreSQL.
