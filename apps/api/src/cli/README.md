# Configuración inicial de Billing y Legal

`bootstrap:billing` y `bootstrap:legal` son comandos manuales de servidor. No forman parte de Nest, las APIs,
los seeds ni el arranque. La API continúa rechazando autoasignaciones.

## Condiciones

- Identity debe confirmar con `/oidc/userinfo` que el token personal vigente pertenece al destinatario.
- El destinatario debe ser la única identidad con administración de plataforma activa,
  en una organización interna activa, con membresía activa y el producto correspondiente habilitado.
- Debe existir el catálogo v1 del producto publicado. El destinatario no debe tener historial
  de asignaciones del producto, ni siquiera revocadas o en otra membresía.
- No debe existir un recibo anterior de bootstrap para ese producto, salvo un reintento del mismo destinatario.
- Todas las migraciones deben estar aplicadas explícitamente. El comando no las ejecuta.

La credencial se entrega en un archivo privado 0600/0400 de máximo 8192 bytes que contiene
solo el access token opaco obtenido por el flujo OAuth personal de Identity. No usar un token
de `client_credentials`, una contraseña ni un token de otro usuario. No guardarlo en Git.
`IDENTITY_ISSUER` y la conexión Access se cargan de la configuración del servidor. HTTPS
obligatorio salvo loopback en desarrollo.

## Ejecución

Desde `access/apps/api`, primero revisar sin escribir:

```bash
bun run bootstrap:billing --email admin@hemia.mx \
  --membership-id fd314e96-8274-4e48-a2d4-fb0ae4b719f3 \
  --reason 'Configuración inicial autorizada del administrador operativo de Billing' \
  --token-file /ruta/privada/identity-access-token
```

Ejecutar el mismo comando con `--apply` para aplicar. Los identificadores del ejemplo
corresponden al entorno de desarrollo Hemia; verificar la vista previa en cada entorno.
Eliminar el archivo temporal del token después de usarlo.

El conjunto es fijo y no acepta roles arbitrarios: `billing.catalog_manager` con
`catalog_global`; `billing.operator`, `billing.invoice_operator`, `billing.integration_operator`
y `billing.auditor` con `all_customers`. Las concesiones no tienen vencimiento y pueden
revocarse por la administración normal de Access. No se otorga autoridad para delegar.

## Transacción, auditoría y reintentos

La operación bloquea temporalmente las tablas de autoridad y concesiones, con timeout
para fallar y revertir ante contención. Se valida dentro del bloqueo y se insertan cinco
asignaciones; los triggers existentes las sellan al commit. Se incrementa una vez
`context_version` de la membresía, se guarda un evento outbox de invalidación y un recibo
`system_role.bootstrap` en auditoría. Un error en cualquiera revierte todo.

El recibo registra destinatario, IDs de concesiones, alcance, motivo y ejecutor real del
comando (usuario del SO, UID y host), con `actor_type=bootstrap`. `created_by_identity_id`
referencia al propio destinatario que prueba su identidad; el recibo explica explícitamente
la excepción de configuración inicial, sin inventar otro administrador.

Un índice único permite un solo recibo por producto. Triggers rechazan editarlo, borrarlo
o truncar auditoría después de consumirlo; la migración tampoco se revierte si ya se usó.
Los reintentos del mismo destinatario devuelven el recibo, nunca vuelven a conceder roles
revocados ni cambian sus alcances. Los reintentos para otro destinatario fallan.

El comando publica mediante el outbox normal, sin arrancar consumidores o publicadores.
Para verificar desde Billing, iniciar una sesión nueva: una sesión anterior puede conservar
la lista de organizaciones obtenida cuando todavía no existían concesiones. Las decisiones
GET de Billing tienen una ventana máxima de 60 segundos según su contrato.

## Verificación aislada

La prueba Docker de bootstrap se retiró. Si se cambia este flujo, reconstruirla contra una
base PostgreSQL desechable y comprobar vista previa sin escrituras, elegibilidad,
prohibición normal de autoasignación, rollback por fallo de outbox, concurrencia, roles
efectivos, recibo único e inmutable, invalidación y reintentos tras revocación. La prueba
de BD no sustituye la comprobación HTTP de Identity con un token real. Ver
[`test/README.md`](../../../../test/README.md) para el procedimiento seguro.

## Legal

Ejecutar primero sin `--apply` para revisar:

```bash
bun run bootstrap:legal --email admin@hemia.mx \
  --membership-id fd314e96-8274-4e48-a2d4-fb0ae4b719f3 \
  --reason 'Configuración inicial autorizada del administrador operativo de Legal' \
  --token-file /ruta/privada/identity-access-token
```

Agregar `--apply` para confirmar. El recibo de Legal es independiente del de Billing;
no se necesita otra migración. Los cinco roles usan alcance de recursos `legal_global`:

| Roles | Alcance de consumidores |
| --- | --- |
| `legal.editor`, `legal.publisher`, `legal.catalog_manager` | `not_applicable` |
| `legal.auditor`, `legal.notification_operator` | `all_organizations` |

No requieren tenant local. No conceden aceptación personal de documentos, evaluación
técnica entre servicios ni administración de asignaciones en Access. No vencen y se
revocan mediante la administración normal. Iniciar una nueva sesión de Legal después
de aplicar y verificar `/v1/legal/session`.

La prueba Docker de Legal también se retiró. Si cambia el bootstrap o el código compartido,
reconstruir las garantías transaccionales para ambos alcances de consumidores según
[`test/README.md`](../../../../test/README.md).
