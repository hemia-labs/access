# Activación coordinada de roles y permisos

Access es la fuente de membresías, roles y asignaciones de sistema. Identity
sólo autentica. Cada producto verifica el contexto firmado y exige su permiso
para la acción y su alcance para el recurso. El frontend refleja esos permisos;
la decisión definitiva se toma en el backend.

La retirada de `authenticated` no convierte los permisos temporales de una
sesión en roles permanentes. Esta versión no modifica datos al iniciar.

## Preparación antes de publicar una versión activa

1. Inventariar las identidades humanas, membresías, productos habilitados,
   roles efectivos y delegaciones del ambiente destino. Comprobar estado,
   organización, fechas y ambas dimensiones de los alcances. No migrar todas
   las cuentas a administrador.
2. Concretar las funciones que debe conservar cada operador. La administración
   de una organización no equivale a `platform_super_admin`; Console exige
   explícitamente administración de plataforma y el permiso `*` de plataforma.
   Preparar al menos un operador de plataforma autorizado y verificar su acceso.
3. Publicar los catálogos compatibles y usar los endpoints normales de Access
   para registrar las asignaciones aprobadas. Conservar el historial, auditoría,
   outbox e invalidación de contexto. No ejecutar seeds para reasignar usuarios.
4. Verificar las funciones de cada operador antes del corte. Un rol
   `billing.webhook_viewer` global sólo concede lectura de webhooks. Para
   conservar compras, facturas, auditoría, integraciones y catálogo hacen falta
   los roles correspondientes, con organización explícita cuando corresponda.
   La lectura global no debe ampliar el alcance de reintentos u otras acciones.
   Legal distingue además el alcance del recurso del alcance del consumidor.
5. Revisar cualquier workspace o autorización local de otros productos antes
   de su activación. No asignar una organización a datos anteriores por orden
   de creación, por nombre o porque el primer usuario tenga rol administrador.

## Publicación y comprobación

Preparar las asignaciones y los consumidores compatibles antes de activar
Access por roles. Los despliegues de Access, Billing, Legal y Console fijan
`HEMIA_AUTHORIZATION_MODE=roles` tanto en Compose como en la configuración
remota privada. Access fija también su antiguo override Billing a `roles`.
Los secretos se conservan y el cambio de configuración genera una copia privada.
La versión estricta rechaza valores antiguos en lugar de conceder acceso.

La publicación de código, la creación de una release y el despliegue son pasos
distintos. No fusionar una versión que vaya a desplegarse automáticamente hasta
completar la preparación de asignaciones en ese ambiente. Conservar las versiones
previas y revisar compatibilidad de esquema al preparar cualquier recuperación.
Una recuperación de imágenes tampoco debe reactivar `authenticated`.

Renovar las sesiones de los productos y resolver contextos nuevos después del
corte. Los contextos ya firmados pueden conservar vigencia hasta su expiración;
no basta con cambiar una variable en un único servicio. Verificar en las
instancias reales:

- El operador autorizado conserva navegación y acciones aprobadas.
- Un usuario sin rol recibe denegación en la API y en la navegación.
- La lectura de webhooks devuelve los eventos cubiertos por el alcance global.
- El lector de webhooks no puede reintentar ni descargar payloads.
- Los permisos de otras funciones siguen limitados a su organización.
- Las asignaciones revocadas, caducadas o de otro producto no conceden acceso.
- Las integraciones máquina siguen usando sus propias acciones y alcances.

Registrar versiones y resultados observados. Las pruebas locales no demuestran
que la configuración, los datos ni las sesiones productivas ya hayan cambiado.
