# web

## 1.4.2

### Patch Changes

- 12be32e: Expone los permisos de los roles publicados y permite a los administradores de plataforma consultar las asignaciones por membresía. Aplica la misma autoridad a las operaciones directas de Billing y Legal, con los flujos de delegación existentes.

## 1.4.1

### Patch Changes

- c963edd: Exige el rol de administrador de plataforma para administrar asignaciones directas de Billing y devuelve los IDs de los roles de catálogos publicados.

## 1.4.0

## 1.3.1

### Patch Changes

- eef7404: Reduce production image size by keeping Debian, Node and required runtime libraries while excluding package managers and development files. Preserve explicit migrations, non-root execution and the standalone Next.js server.

  Use the local Console URL by default for development welcome emails, preserving the production URL and explicit EMAIL_CONSOLE_URL overrides.

## 1.3.0

## 1.2.0

## 1.1.0

### Minor Changes

- 91d8866: Add SES invitation delivery, signed Identity onboarding and secure membership acceptance.

## 1.0.0
