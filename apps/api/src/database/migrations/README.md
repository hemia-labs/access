# Migraciones vigentes

Verificación y limpieza del 2026-10-21 en `access_feature` e `identity_feature`, servidor configurado `192.168.100.103:5432`, esquema `public`. No representa otros entornos.

## Access

Las seis migraciones de este directorio continúan activas y aplicadas: esquema base, inbox de eventos, autorización por roles de sistema, alcances de Legal, Legal sin aprovisionamiento local y protección del bootstrap. No hay migraciones pendientes.

Las ocho migraciones retiradas de policies/WASM ya estaban aplicadas. Sus fuentes se respaldaron fuera del repositorio y se eliminaron del código. Sus entradas en `migrations` permanecen como historial de ejecución: catorce entradas históricas y seis migraciones vigentes.

Por solicitud explícita se eliminaron directamente de la BD las dieciséis tablas de policies/planes/releases, tres funciones y diez triggers asociados, los permisos `policy.read`/`policy.manage`, seis asignaciones de esos permisos y la identidad técnica del publicador. Se usaron transacciones y `DROP ... RESTRICT`, con respaldos completos previos; no se creó ni ejecutó una migración nueva. Se conservaron las tablas y registros de auditoría, outbox, organizaciones y autorización RBAC.

Las bases nuevas ejecutan únicamente las seis migraciones vigentes. Las bases antiguas de otros entornos requieren verificar su estado antes de repetir una limpieza directa. El CLI no puede revertir las migraciones retiradas que aún consten en su historial; no borrar ese historial para simular una reversión.

## Identity

Ambas migraciones continúan activas y aplicadas: esquema inicial y `OAuthServiceDestinations1791259200000`. Destinos y audiencia siguen siendo necesarios para OAuth `client_credentials` con secreto. No hay migraciones pendientes.

La limpieza directa retiró el cliente exclusivo `hemia-access-policy-publisher` con sus dos tokens de servicio y los scopes obsoletos del cliente administrativo de Access. El seed vigente también excluye esos scopes. No se eliminaron sesiones humanas ni clientes de otros servicios.

Según ADR-012, las migraciones y seeds siguen siendo manuales. El arranque conserva `synchronize: false` y `migrationsRun: false`; `/health/ready` reporta `pending_migrations` cuando corresponde.
