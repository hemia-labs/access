---
"api": patch
"web": patch
---

Reduce production image size by keeping Debian, Node and required runtime libraries while excluding package managers and development files. Preserve explicit migrations, non-root execution and the standalone Next.js server.

Use the local Console URL by default for development welcome emails, preserving the production URL and explicit EMAIL_CONSOLE_URL overrides.
