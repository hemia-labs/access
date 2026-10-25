# Changesets de Access

API (`api`) y panel (`web`) comparten version y se publican como imagenes privadas,
no como paquetes npm. Agregar `bun run changeset` a cada PR funcional.

El merge a main crea/actualiza la PR de version. Fusionarla publica tag
`access-vX.Y.Z`, Release `Access X.Y.Z` y ambas imagenes verificadas por digest.
El deploy automatico requiere `prod.ENABLE_ACCESS_DEPLOY=true`.

Migraciones y seeds son explicitos, nunca parte del arranque. Consultar
[CI/CD de Access](../docs/access-ci-cd.md) para GitHub, registry y VM.
