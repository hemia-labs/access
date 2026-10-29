# api

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
