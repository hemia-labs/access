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
