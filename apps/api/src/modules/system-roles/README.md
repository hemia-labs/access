# Modelo de autorización de sistemas

Estado: entidades y servicios/endpoints de revocación y reemplazo implementados. Migración validada en PostgreSQL 18.4 con Docker y aplicada en `access_feature` el 2026-09-15. No se ejecutaron seeds. La publicación inicial del catálogo y las altas de concesiones/delegaciones ya tienen APIs explícitas; no se ejecutaron sobre usuarios reales. El contexto Billing ya evalúa estas asignaciones y su autoridad vigente.

Contrato de referencia: [autorización de Billing v1](../../../../../../identity/docs/contrato-autorizacion-billing-v1.md).

La protección de la elegibilidad y de las rutas de administración interna está implementada en [Organizaciones](../organizations/README.md). La revocación y el reemplazo incrementan versiones y generan el evento de invalidación consumido por Billing/Legal. La evaluación efectiva para Billing está implementada en `SystemAuthorizationService`, sin caché de decisiones.

## Entidades

| Tabla                            | Responsabilidad                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `system_roles`                   | Rol de un producto y versión de catálogo. Su significado y permisos pertenecen al sistema consumidor.              |
| `system_role_scopes`             | Alcances admitidos por cada rol: `catalog_global`, `all_customers`, `organizations`.                               |
| `system_role_assignments`        | Rol asignado a una membresía, alcance, vigencia, autor, revocación, versión e idempotencia.                        |
| `system_role_assignment_targets` | Organizaciones cuyos recursos puede operar la asignación.                                                          |
| `system_role_delegations`        | Autoridad administrativa concedida a una membresía para un rol, alcance y organización de empleados destinatarios. |
| `system_role_delegation_targets` | Organizaciones de recursos que delimitan la autoridad delegada.                                                    |

La organización de la membresía identifica dónde pertenece el empleado; los destinos identifican sobre qué clientes puede actuar. `recipient_organization_id` limita a qué organización deben pertenecer los empleados que reciben las asignaciones de una delegación. Son dimensiones distintas.

Cada delegación contiene un rol y una organización destinataria. Una persona puede recibir varias delegaciones. No existe una relación entre delegaciones que permita subdelegar. `can_grant` y `can_revoke` separan ambas capacidades y al menos una debe estar habilitada.

Las asignaciones directas tienen `delegation_id = NULL`; las delegadas conservan su procedencia. Esto no habilita a cualquier actor a crear asignaciones directas: el servicio debe autorizar al actor antes de escribir.

## Integridad en PostgreSQL

- Claves foráneas hacia productos, membresías e identidades existentes; sin borrado en cascada.
- Rol único por producto, código y versión de catálogo. El alcance debe estar registrado para ese rol.
- Destinos únicos por asignación/delegación y organización. Solo `organizations` admite destinos, y exige al menos uno al finalizar la transacción.
- Vigencia con fin posterior al inicio; revocación con autor y fecha obligatorios; versiones positivas.
- Idempotencia de asignaciones única por autor y clave. No hay unicidad por membresía/rol: puede haber asignaciones legítimas con distintos alcances o vigencias.
- `replaces_assignment_id` y `replaces_delegation_id` enlazan al registro anterior, con FK, unicidad y prohibición de autorreferencia. El trigger exige predecesor revocado, mismo destinatario y producto. Para una delegación, destinatario significa la membresía administradora; la organización de empleados que puede administrar puede cambiar en el reemplazo.
- Las delegaciones también tienen clave idempotente única por autor.

## Creación cerrada e historia inmutable

Asignaciones, delegaciones y roles tienen `sealed`, un campo técnico que no se admite en contratos administrativos. Se insertan abiertos, activos y, para concesiones, en versión 1. Su definición es inmutable desde la inserción; únicamente se pueden agregar sus hijos mientras el padre está abierto.

En la misma transacción se insertan todos los destinos (o alcances del rol). Un constraint trigger diferido valida el conjunto y cierra el padre antes del commit. Cada rol exige al menos un alcance; `organizations` exige destinos. Ningún padre abierto queda confirmado. Se realiza una actualización de cierre por padre, no una por destino, y el cierre no incrementa la versión de la concesión.

Después del cierre, no se pueden insertar más hijos. UPDATE y DELETE de hijos están prohibidos incluso durante la creación: ante una entrada equivocada se revierte la transacción. DELETE y TRUNCATE están prohibidos en las seis tablas para conservar el historial. El rol de conexión de aplicación no debe tener capacidad de deshabilitar triggers o alterar el esquema.

La única transición de una concesión cerrada es `active → revoked`, con autor, fecha y `version + 1`. No se reabre, reactiva ni altera su rol, membresía, alcance, fechas, destinos, procedencia o enlace de reemplazo. Un rol publicado solo permite `active → disabled`; su definición y alcances no cambian ni se reactiva silenciosamente esa versión.

No activar constraints inmediatos antes de insertar los hijos: cerrarían el padre anticipadamente y rechazarían un conjunto incompleto. Si se necesita forzar su validación, hacerlo después de insertar el conjunto completo. Leer nuevamente el padre después del commit cuando se necesite conocer `sealed`: el resultado inicial de INSERT puede reflejar todavía `false`.

## Reemplazo atómico

La operación administrativa implementada en `SystemRoleHistoryService` realiza:

1. Resolver actor e idempotencia, comprobar autoridad vigente y bloquear la concesión anterior; rechazar versión obsoleta o un reemplazo distinto ya existente.
2. Revocar la anterior y crear la nueva con su referencia `replaces_*_id` y destinos, sin borrar datos anteriores.
3. Incrementar `context_version`, registrar auditoría y outbox dentro de la misma transacción. Publicar/invalidar caché después del commit.
4. Ante fallos, revertir todo; un reintento idéntico devuelve la misma concesión nueva. Una misma clave con contenido diferente es conflicto.

La FK y unicidad impiden enlaces rotos y dos sucesores del mismo registro. El trigger bloquea el predecesor y verifica producto y destinatario; no sustituye la autorización del actor ni obliga por sí solo a que una revocación previa se haya realizado en esa misma transacción. Esa atomicidad la implementa el servicio administrativo con una transacción `SERIALIZABLE`.

Reemplazar una delegación no cambia `delegation_id` en sus asignaciones. Estas conservan la procedencia original y deben dejar de autorizar cuando su delegación se revoca o expira. Reasignarlas requiere nuevas concesiones evaluadas contra la autoridad nueva.

## Reglas de autorización

1. Solo un administrador de plataforma explícitamente autorizado crea o revoca delegaciones; no se deriva esa autoridad de `org_admin`.
2. Validar membresía, organización y rol habilitados, además de la elegibilidad interna mediante la clasificación existente `organization.type = 'internal'`. Restringir también quién puede modificar esa clasificación.
3. Prohibir autoasignaciones comparando identidad, no solo membresía. Una asignación delegada exige delegación vigente, `can_grant`, mismo rol, organización destinataria correcta y alcance, destinos y vigencia contenidos en la autoridad concedida. Nunca ampliar privilegios por unir delegaciones incompatibles.
4. `can_revoke` requiere verificar el rol, destinatario y alcance de la asignación objetivo. No habilita a administrar delegaciones.
5. Resolver la autorización efectiva con vigencia y revocación tanto de la asignación como de su delegación. Revocar o expirar una delegación invalida el acceso derivado.
6. Reemplazar atómicamente las concesiones cuando cambien rol, alcance, vigencia o procedencia; incrementar versiones, registrar auditoría y outbox en la misma transacción e invalidar contextos. No permitir escrituras genéricas que eludan estas comprobaciones.
7. Rechazar duplicados semánticos y claves idempotentes reutilizadas con otro contenido; la restricción única solo protege la carrera de inserción.
8. Registrar el catálogo aprobado de Billing y sus alcances mediante un mecanismo explícito, fuera del arranque. Los seis roles y su mapa de permisos no se insertan con esta migración.

Las rutas de revocación/reemplazo implementan las comprobaciones de autoridad, elegibilidad para nuevas concesiones, autoasignación, contención, duplicados e idempotencia. La creación inicial y la publicación del catálogo aún requieren implementación. Las claves foráneas garantizan integridad relacional, no autorización administrativa.

## Migración y comprobaciones

`1789171200000-AddSystemRoleAuthorization.ts` crea estas seis tablas, índices, restricciones y triggers. No modifica asignaciones previas, no introduce claims de Identity ni adaptadores de compatibilidad. Los roles organizacionales existentes pertenecen a otro dominio.

La migración debe aplicarse explícitamente en una transacción, nunca en el arranque. El rollback elimina exclusivamente las tablas nuevas y sus funciones, junto con sus datos: no debe utilizarse como mecanismo de revocación.

Las pruebas unitarias bajo `test/api/unit/` construyen metadatos TypeORM y verifican la orquestación del servicio. La suite de integración Docker y su regresión SQL fueron retiradas; antes cubrían esquema nuevo e incremental, restricciones, rollback e interacciones concurrentes. Para reconstruirlas con una base aislada, consulta [`test/README.md`](../../../../../test/README.md). No ejecutar migraciones de prueba sobre la base configurada de desarrollo.

La regresión SQL histórica verificaba el cierre y los intentos de reescribir historia sobre un esquema ya migrado. Su archivo se retiró; reconstruirla si se modifica esa migración, siguiendo [`test/README.md`](../../../../../test/README.md).


## Endpoints de historia implementados

Todos requieren autenticación mediante `AccessAuthGuard`. La autoridad se consulta de nuevo dentro de la transacción; no se toma de campos enviados por el cliente ni de un permiso organizacional genérico.

| Método y ruta | Operación |
| --- | --- |
| `POST /v1/system-roles/assignments/:id/replacements` | Revocar A y crear B con nuevos rol, destinos o vigencia. |
| `POST /v1/system-roles/assignments/:id/revoke` | Revocar A, conservando sus destinos. |
| `POST /v1/system-roles/delegations/:id/replacements` | Reemplazar autoridad sin transferir asignaciones derivadas. |
| `POST /v1/system-roles/delegations/:id/revoke` | Revocar autoridad e invalidar las membresías derivadas. |

Ejemplo de cuerpo para reemplazar una asignación de Ana (UUID ilustrativos):

```json
{
  "expectedVersion": 1,
  "idempotencyKey": "77777777-1111-4111-8111-111111111111",
  "roleId": "44444444-1111-4111-8111-111111111111",
  "scopeType": "organizations",
  "organizationIds": ["66666666-1111-4111-8111-111111111111"],
  "validFrom": "2026-09-15T00:00:00Z",
  "expiresAt": null
}
```

La revocación recibe `expectedVersion`. Un administrador delegado debe enviar además `authorityDelegationId` tanto para revocar como para reemplazar asignaciones. Se comprueba que sea titular vigente de esa delegación, con `can_revoke` y contención del alcance anterior; el reemplazo exige también `can_grant` y contención del nuevo alcance y vigencia. No se combinan autoridades. Sin ese campo se exige `platform_super_admin` vigente. Las delegaciones solo las administra plataforma; su reemplazo añade `recipientOrganizationId`, `canGrant` y `canRevoke` y no admite autoridad delegada.

La membresía destinataria se conserva. Para nuevas concesiones se comprueban identidad humana activa, membresía vigente, organización interna activa y rol/producto habilitados. La revocación sigue permitida aunque el destinatario haya perdido elegibilidad. Se rechaza la autoasignación comparando identidades. Los campos desconocidos, destinos repetidos y combinaciones de alcance/destinos inválidas se rechazan. Se establece un límite operativo de 1.000 destinos por petición, pendiente de validar con mediciones de carga; no es una afirmación de capacidad demostrada.

Se bloquean la concesión, membresías y filas que sustentan la autoridad para coordinar la operación con cambios concurrentes. Conflictos de versión, unicidad, serialización o deadlock devuelven `409`; el cliente debe reintentar el mismo contenido y clave, o recargar el estado si la versión ya cambió. Una clave reutilizada con otro contenido nunca reemplaza otro registro. El resultado contiene `id`, `version` y `replayed`; un reintento idéntico no vuelve a incrementar versiones ni emitir auditoría/outbox. La revocación se reconoce por concesión, versión previa y actor.

La misma transacción incrementa `context_version` y `version` de las membresías afectadas, registra auditoría con los destinos originales y la nueva concesión, y guarda `access.membership.context_invalidated.v1` en outbox por membresía. Para delegaciones incluye la membresía administradora y las de sus asignaciones derivadas, sin modificar `delegation_id`. RabbitMQ se publica mediante el publicador de outbox existente después del commit. La caché de contexto por identidad se elimina después del commit; si Redis falla, el reintento vuelve a eliminarla sin repetir las escrituras confirmadas.

La invalidación no convierte por sí sola un JWT ya emitido en inválido. Para Billing, el emisor ahora evalúa en cada resolución la asignación, su delegación original, autor, membresía e identidad administradoras, organización interna, rol, producto y vigencias. Billing exige una resolución nueva en cada petición de consola; no reutiliza un contexto anterior si Access deniega o falla. El JWT dura como máximo 300 segundos y nunca supera la expiración más próxima de las autoridades incluidas. Esto no cancela operaciones que ya habían sido autorizadas y estaban en ejecución.


## Recuperar las pruebas de integración

El comando y la suite Docker descritos anteriormente se retiraron. La validación histórica del 2026-09-15 pasó ocho comprobaciones de integración, 69 pruebas unitarias y compilación; no equivale a una ejecución actual. Para recuperar los casos y el procedimiento seguro con PostgreSQL desechable, consulta [`test/README.md`](../../../../../test/README.md).


## Evaluación efectiva de Billing

`GET /v1/me/context?product=billing` devuelve solo organizaciones con asignaciones efectivas. `POST /v1/me/context/resolve` con `product_code: billing` emite exclusivamente el perfil `hemia-context+jwt`, `aud: billing-api`, contrato/catálogo v1 y `assignments`. No admite elegir otra audiencia. Los roles/permisos organizacionales siguen perteneciendo al contexto administrativo de Access y no conceden acceso a Billing.

La evaluación usa un único snapshot SQL sin caché. Una asignación delegada exige que su autor sea el titular de su delegación original, que ambos sean identidades distintas, que coincidan rol y organización destinataria y que alcance, destinos y vigencia estén contenidos. Se excluye si la delegación, su titular, su organización o su identidad dejan de estar habilitados. Reemplazar la delegación nunca hace que sus asignaciones hereden la nueva autoridad.

Límites explícitos v1: 64 asignaciones por resolución/discovery, 1.000 referencias a destinos en total y 128 KiB de claims antes de firmar. Se rechaza por completo el exceso (`409`), sin truncar ni ampliar a `all_customers`. Son límites operativos conservadores, no mediciones de capacidad.

La suite Docker retirada también verificaba JWT real con JWKS, delegaciones reemplazadas/revocadas, autoridades suspendidas/vencidas, productos deshabilitados y límites de expiración. Reconstruir esos casos si cambia la autorización de Billing; ver [`test/README.md`](../../../../../test/README.md). Para desplegar sigue siendo necesario publicar explícitamente el catálogo v1 y conceder asignaciones.


## Invalidación de elegibilidad y dependencias

Los cambios de estado de una membresía y los cambios efectivos de `expires_at` invalidan tanto esa membresía como los destinatarios de sus delegaciones, incluso en otras organizaciones. Cambiar la clasificación, el estado o archivar una organización aplica la misma regla desde todas sus membresías. `invalidateAuthorization` reúne ambas fuentes con `UNION`: varias delegaciones hacia una membresía producen un solo incremento y un solo evento de invalidación por operación. Incluye dependencias históricas conservadoramente, ya que restaurar elegibilidad o extender vigencia puede volver a habilitar concesiones.

Las rutas guardan el cambio, los incrementos de `context_version`/`version`, la auditoría y los eventos de outbox en una misma transacción. Cada evento identifica la organización y la identidad reales del destinatario. Las actualizaciones de membresía bloquean su fila para no sobrescribir versiones concurrentes. La eliminación de caché de todas las identidades afectadas ocurre después del commit; un fallo de auditoría u outbox revierte también las versiones y no elimina caché.

`expires_at` admite una fecha ISO o `null` para quitar el vencimiento; omitirlo conserva el valor. Acortar, extender o quitar una fecha invalida; reenviar la misma fecha o editar solo metadata no incrementa `context_version` ni genera invalidación de autorización.

El paso del tiempo no escribe versiones ni emite eventos automáticamente. La vigencia se evalúa al resolver y limita `exp` del JWT. Un consumidor que introduzca caché de decisiones debe limitarla también por ese vencimiento: no puede considerar `context_version` como única condición de validez. No se agregó un proceso programado de expiración.

La suite Docker retirada ejecutaba los servicios reales con delegador y destinatario en organizaciones distintas, suspensión/reactivación y cambios de vencimiento; comprobaba versiones, eventos, rollback y eliminación de caché posterior al commit. Reconstruir esta cobertura si se modifica la invalidación; ver [`test/README.md`](../../../../../test/README.md).

La autorización consulta autoridad vigente en cada petición y depende de PostgreSQL. El benchmark anterior fue retirado; no se conserva un runner de rendimiento vigente.


## Revocaciones masivas y publicación

Las invalidaciones de historial y elegibilidad escriben el outbox mediante `OutboxService.recordMany`: hasta 500 eventos por INSERT, conservando un evento por membresía, su versión y toda la operación en la transacción original. No se confirma por lotes; si falla un lote posterior, se revierten también los anteriores y la revocación. La actualización de las membresías sigue siendo proporcional al conjunto afectado y conserva sus bloqueos hasta commit; esta optimización no garantiza un tiempo constante para volúmenes arbitrarios.

El publicador procesa 100 eventos por lote. Al completar un lote lleno continúa sin esperar cinco segundos; cuando no hay un lote completo o falla la consulta, vuelve al sondeo de cinco segundos. Hay un único procesamiento activo por instancia, incluso ante llamadas manuales. Se conservan leases de publicación, reintentos con backoff y dead letter. El claim comprueba de nuevo que `next_attempt_at` haya vencido para no saltarse un backoff establecido por otro trabajador. La entrega sigue siendo al menos una vez: los consumidores deben deduplicar por ID.

Cada lote deja un log estructurado `metric: access_outbox_batch` con `selected`, `published`, `duration_ms`, `oldest_selected_age_ms` y `publication_lag_p95_ms`/`publication_lag_p99_ms`. El retraso se mide desde `occurred_at` hasta la confirmación de publicación del cliente; incluye el tiempo de transacción y espera. Los percentiles son del lote, no percentiles globales. `selected` puede exceder `published` por fallos o claims tomados por otra instancia. Los fallos de broker conservan backoff y los agotados generan el error de dead letter existente.

La suite Docker retirada probaba una delegación con 1.200 destinatarios, 1.201 eventos únicos y rollback si fallaba un lote; también usaba el programador real del publicador para vaciar el backlog. El broker se simulaba: no medía RabbitMQ ni la entrega al consumidor. Ver [`test/README.md`](../../../../../test/README.md) si se necesita reconstruirla.

Referencia local del 2026-09-15: revocación de 1.200 destinatarios en aproximadamente 55 ms; vaciado de 1.201 eventos en 2,56 s; retraso p95 de 2,52 s y p99 de 2,59 s. Son observaciones de una ejecución aislada, no un SLO ni capacidad demostrada de producción. Deben contrastarse con los logs del publicador y pruebas con RabbitMQ real. No cambia la resolución fresca de Billing mientras se propagan los eventos.

## Límites agregados de concesiones de Billing

Los límites del resolver y del reemplazo comparten `BILLING_MAX_ASSIGNMENTS = 64` y `BILLING_MAX_TARGET_REFERENCES = 1000`. Antes de reemplazar una asignación, `assertBillingAssignmentBudget` calcula el resultado: excluye la anterior y suma la propuesta. El ámbito es **identidad + producto**, atravesando todas sus membresías/organizaciones, porque el descubrimiento de organizaciones de Billing también lee el conjunto de asignaciones de la identidad. Los destinos repetidos entre asignaciones cuentan como referencias independientes, igual que en el resolver; no se deduplican para aparentar una capacidad mayor.

La reserva incluye asignaciones con estado activo y sin vencimiento alcanzado, aunque empiecen en el futuro o temporalmente no autoricen por la membresía, organización, rol, producto o delegación. Esto evita que una reactivación o el paso del tiempo excedan los límites. Es deliberadamente más conservadora que la consulta de permisos efectivos: incluso una asignación cuyo delegado perdió autoridad consume reserva hasta que se revoque o venza. Las revocadas y vencidas no cuentan, y los otros productos no consumen el presupuesto de Billing.

El cálculo ocurre en la transacción SERIALIZABLE, antes de revocar o insertar. Se bloquea también la identidad destinataria, además de la membresía, para coordinar operaciones entre organizaciones. Un exceso devuelve `409 ACCESS_CONTEXT_TOO_LARGE` con los totales calculados; no se escriben revocación, sustituta, versiones, auditoría ni outbox. Un conflicto concurrente conserva el contrato de `409` y reintento con la misma clave. Se siguen admitiendo revocaciones para reparar datos que ya estuvieran sobre el límite, así como el replay idempotente de un reemplazo confirmado.

El endpoint de concesión inicial invoca el mismo validador sin excluir una asignación existente, después de validar autoridad y rol, bajo el mismo bloqueo de identidad y transacción SERIALIZABLE. No se agregaron triggers de cuota ni se ejecutaron migraciones: escrituras directas a PostgreSQL omiten esta protección del servicio. El resolver mantiene su rechazo sin truncamiento como última defensa.

La regresión Docker retirada comprobaba 600 + 500 destinos rechazados sin efectos, exactamente 1.000 aceptados, capacidad futura reservada, concurrencia entre organizaciones, reparación mediante revocación y replay idempotente. Reconstruir estos casos si cambia el límite; ver [`test/README.md`](../../../../../test/README.md).


## Registro y altas iniciales

`POST /v1/system-roles/catalogs/billing/v1` recibe `{}` y requiere un administrador de plataforma vigente. Publica la proyección administrativa revisada `billing-role-catalog.ts` de Billing; no acepta una definición arbitraria, URL o mapa de permisos. Retorna IDs/códigos de los seis roles. Es idempotente; un catálogo parcial o divergente devuelve 409. No reactiva roles deshabilitados. Los permisos permanecen en Billing.

`POST /v1/system-roles/assignments` recibe `membershipId`, `roleId`, `idempotencyKey`, `scopeType`, `organizationIds`, `validFrom` y `expiresAt` (UTC o null). Un administrador delegado debe añadir `authorityDelegationId`; se exige `canGrant` vigente y contención de rol, destinatarios y vigencia. No se exige `canRevoke` para crear. Solo plataforma crea delegaciones en `POST /v1/system-roles/delegations`, con los mismos campos más `recipientOrganizationId`, `canGrant` y `canRevoke`. Las altas no reciben `expectedVersion` ni campos internos.

Todas las altas conservan idempotencia, bloqueo por identidad, límites agregados, auditoría/outbox y eliminación de caché después del commit. Se deniega autoasignación y subdelegación. La regresión Docker retirada probaba catálogo real, alta directa, delegación de solo concesión, límites de alcance, revocación y replay. Reconstruirla si cambia el flujo; no son seeds de arranque. Ver [`test/README.md`](../../../../../test/README.md).

## Regresión de Billing previa a extender el esquema

La regresión de Billing retirada preparaba datos confirmados sobre el esquema hasta `AddSystemRoleAuthorization1789171200000` y reservaba las migraciones posteriores para ejecutarlas **después** de capturar autorización e historial. Nunca ejecutaba migraciones en las bases configuradas de desarrollo. Para recrearla, consulta [`test/README.md`](../../../../../test/README.md).

La prueba publica el catálogo real y crea concesiones para los seis roles y cada alcance permitido, una asignación directa revocada, una delegación vigente y otra revocada cuya asignación permanece activa pero no autoriza. Usa identidades propias para no alterar las pruebas existentes. Comprueba descubrimiento de organización, denegación sin concesión efectiva, aislamiento de organización y JWT real verificado con JWKS (audiencia, tipo, firma, contrato/catálogo v1, vigencia y destinos). Compara los claims antes/después, excluyendo únicamente los valores de emisión `jti`, `iat`, `nbf` y `exp`; comprueba además la duración del token en ambas fases.

También compara todas las filas y columnas preexistentes de las seis tablas de autorización, membresías, auditoría y outbox. Permite columnas nuevas, pero detecta pérdidas o modificaciones de IDs, destinos, procedencia, estados y versiones, así como eventos añadidos inesperadamente por la migración.

A fecha 2026-09-20 todavía no existe una migración posterior para los alcances de Legal. En ese caso el arnés informa `0 new migration(s)`: valida la línea base y la comparación, **no certifica una migración futura**. Cuando se agregue, se ejecutará entre ambas capturas. Esta regresión cubre el contrato de Access consumido por Billing; no sustituye las pruebas del evaluador local ni la aceptación HTTP del sistema completo.

## Cliente de validación de destinos Legal

`LegalTargetValidationClient.validate(targetType, ids)` está registrado/exportado por SystemRolesModule. Admite legal_issuer/legal_application y entre 1 y 1.000 UUID únicos. Obtiene un token client_credentials de access-legal-validator y consulta el endpoint interno de Legal. Configuración: LEGAL_VALIDATION_TOKEN_URL, LEGAL_VALIDATION_URL y LEGAL_VALIDATION_CLIENT_SECRET. HTTPS salvo HTTP loopback en desarrollo; secretos únicamente en configuración privada.

Cada llamada consulta Identity y Legal; no hay caché de tokens ni decisiones, reintentos o redirecciones. Cada HTTP tiene timeout de 5 segundos (Legal usa hasta 3 segundos para introspección). Está destinado a administrar concesiones, no a cada petición de Billing. No hace llamadas al inicializarse.

Comprueba cantidad, orden, tipo, identidad de cada destino, estado, relación de emisor y consistencia entre valid/reason. Un resultado negativo rechaza el lote con 400 ACCESS_INVALID_LEGAL_TARGETS; configuración ausente, red, HTTP fallido o respuesta inválida producen 503 ACCESS_LEGAL_VALIDATION_UNAVAILABLE. No propaga cuerpos de error, tokens ni secretos. Devuelve relaciones verificadas, nunca autoridad para conceder roles.

Validación 2026-09-20: 22 casos nuevos del cliente, 93 pruebas Access aprobadas, compilación y lint. Aceptación cruzada con el cliente real, Identity y Legal/PostgreSQL aislado: relación válida, destino desconocido y desactivación del emisor entre consultas. Para reproducir, compilar Access y ejecutar desde Legal/apps/api:

```bash
LEGAL_ACCEPTANCE_CREDENTIALS=/ruta/privada/credentials.json \
ACCESS_LEGAL_CLIENT_MODULE=/ruta/access/apps/api/dist/src/modules/system-roles/legal-target-validation.client.js \
bun run test:targets:docker
```

El archivo privado de credenciales se describe en el README del validador de Legal. La prueba no escribe concesiones ni aplica migraciones en bases compartidas.

## Integración Legal completada en Access — 2026-09-20

La migración nueva `AddLegalSystemScopes1790010000000` implementa las seis entidades y adapta el sellado por dimensión. Solo se ha ejecutado en PostgreSQL Docker aislado. No editar ni reejecutar AddSystemRoleAuthorization para actualizar instalaciones existentes.

`POST /v1/system-roles/catalogs/legal/v1` publica la proyección administrativa legal-role-catalog.ts de los seis roles, restringida a plataforma y con auditoría/outbox (product_code=legal). Es idempotente y rechaza catálogos divergentes. No registra permisos operativos en Access ni concede acceso por publicar.

Los endpoints existentes de assignments/delegations y replacements/revoke ya aceptan y procesan el DTO correspondiente al producto. El rol almacenado determina el perfil permitido: no basta enviar un scope Legal con un roleId Billing. LegalTargets se valida antes de mantener locks de escritura; autoridad y catálogo se vuelven a comprobar dentro de SERIALIZABLE. Las organizaciones consumidoras mantienen FK de Access. Legal conserva autoridad sobre existencia/estado de sus recursos.

Cada concesión mantiene ambos conjuntos de destinos. No se mezclan referencias de distintos grants. Presupuesto por identidad/producto de 64 asignaciones y 1.000 referencias (incluye organizaciones y recursos), contención de delegaciones en ambas dimensiones, sin subdelegar/globales ni autoasignarse. Revocar o reemplazar una delegación no mueve sus asignaciones a otra. Los cambios conservan versiones, auditoría, invalidación y outbox.

`GET /v1/me/context?product=legal` y `POST /v1/me/context/resolve` con product_code=legal usan el resolver de asignaciones efectivas; legal-api es la única audiencia aceptada para ese producto. JWT con typ=hemia-context+jwt, contrato/catálogo v1 y assignments con resource_scope/consumer_scope; sin roles/permisos organizacionales. Expiración máxima 300 segundos limitada por vigencias y máximo 128 KiB. El consumidor deberá aplicar su política de lectura de 60 segundos y resolución fresca para mutaciones. Access no inspecciona la base de Legal en cada resolución.

Despliegue: coordinar consumidor Legal/SDK, pausar escrituras administrativas, respaldar BD, aplicar la migración explícitamente, desplegar Access y publicar catálogo como plataforma. La migración es forward-only y requiere un respaldo verificado para recuperación; no borra concesiones mediante down. No migrar ni publicar desde el arranque. El consumidor actual de Legal todavía necesita su nuevo evaluador y eliminación del mapeo/fallback; no debe desplegarse este corte de Access aisladamente sobre él.

La cobertura histórica de Access incluía Billing antes/después de migraciones, historial SQL, catálogo Legal, seis roles, grants/delegaciones, JWT firmado, límites, revocación, procedencia y rollback. Esa suite Docker fue retirada; reconstruir los casos pertinentes según [`test/README.md`](../../../../../test/README.md). La aceptación cruzada del cliente real con Identity/Legal se documenta aparte y no equivale a aceptar la consola Legal completa.

## Catálogo Legal v2: administración de integraciones

`POST /v1/system-roles/catalogs/legal/v2`, con cuerpo `{}`, publica explícitamente el artefacto inmutable de siete roles. Requiere un usuario autenticado con autoridad vigente `platform_super_admin`; un token de servicio no puede publicarlo. Conserva los seis roles v1 y agrega `legal.integration_manager`, limitado a emisores o aplicaciones y sin dimensión de organización consumidora (`not_applicable`). Las asignaciones v1 siguen vigentes.

Legal define y aplica los permisos `legal.integrations.view/create/edit/disable`; Access publica el rol y sus alcances. Publicar no asigna roles a ninguna persona. La operación es transaccional, genera auditoría y outbox, devuelve el catálogo original al repetirla y rechaza una versión almacenada divergente. Después de publicar, la asignación a un operador y sus destinos debe hacerse explícitamente con la API administrativa existente. No se publica durante el arranque ni mediante migraciones.
