# api

## 1.4.3

### Patch Changes

- 1349f8a: Exigir roles y permisos efectivos en Access y en los contextos de Billing, Legal y Console. Retirar el modo temporal authenticated, rechazar su configuración al iniciar y conservar los alcances, vigencia y políticas de cuentas de servicio existentes.

## 1.4.2

### Patch Changes

- 12be32e: Expone los permisos de los roles publicados y permite a los administradores de plataforma consultar las asignaciones por membresía. Aplica la misma autoridad a las operaciones directas de Billing y Legal, con los flujos de delegación existentes.

## 1.4.1

### Patch Changes

- c963edd: Exige el rol de administrador de plataforma para administrar asignaciones directas de Billing y devuelve los IDs de los roles de catálogos publicados.

## 1.4.0

### Minor Changes

- edde18f: Publica el catálogo de Billing con lectura global de webhooks y permite activar el modo de roles de Billing desde Access.

## 1.3.1

### Patch Changes

- fce75c6: Include the invitation creation or resend timestamp in the signed registration proof. Identity uses this verified date to recover a deleted Google-linked account only when its invitation was issued after deletion, keeping older links from restoring access.
- eef7404: Reduce production image size by keeping Debian, Node and required runtime libraries while excluding package managers and development files. Preserve explicit migrations, non-root execution and the standalone Next.js server.

  Use the local Console URL by default for development welcome emails, preserving the production URL and explicit EMAIL_CONSOLE_URL overrides.

## 1.3.0

### Minor Changes

- 65c51b9: Add a reversible authenticated action mode that skips human role checks while retaining membership, product eligibility, authentication and service policies. Include scoped invitation listing for Console.

## 1.2.0

### Minor Changes

- 2ae1a99: Personaliza los correos de invitación y envía la bienvenida después de aceptar la invitación usando las plantillas SES de Hemia.

## 1.1.0

### Minor Changes

- 91d8866: Add SES invitation delivery, signed Identity onboarding and secure membership acceptance.

## 1.0.0

### Major Changes

- 9c7b3c3: Primer release versionado de Hemia Access: API y panel Docker, registry privado, despliegue por Tailscale/SSH, verificacion de salud y rollback manual. Migraciones y seeds permanecen explicitos.
