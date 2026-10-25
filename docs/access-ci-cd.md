# CI/CD de Hemia Access

Access publica API NestJS y panel Next.js como una aplicacion con version compartida.
Identity conserva su pipeline, imagenes, datos y despliegue independientes.

## Flujo

1. La PR funcional incluye un changeset para `api` o `web`: `bun run changeset`.
2. El merge a `main` ejecuta CI y crea/actualiza la PR de version en
   `changeset-release/main`. El script actualiza ambos package.json, changelogs y
   bun.lock; no publica paquetes npm.
3. Fusionar la PR de version ejecuta tests, builds y smoke Docker antes de publicar.
4. El runner entra a Tailscale mediante OIDC y publica las imagenes probadas:
   `REGISTRY_HOST/access/api:access-vX.Y.Z` y `REGISTRY_HOST/access/web:access-vX.Y.Z`.
5. Crea tag `access-vX.Y.Z` y Release `Access X.Y.Z`, con notas de ambos changelogs.
   Sus assets son `release.json`, `compose.json` y `access-deploy.py`.
   El manifiesto fija commit, digests de imagenes, hashes de assets y migraciones.
   Las imagenes quedan en el registry privado, no como artifacts en GitHub.
6. Si `prod.ENABLE_ACCESS_DEPLOY=true`, reutiliza `deploy.yml` en la misma ejecucion.
   Valida Release inmutable, hashes y pertenencia del tag a main; transfiere los
   assets por SSH. La VM descarga las imagenes exactas por digest, sin construir.
7. Comprueba migraciones pendientes antes de reemplazar contenedores, espera
   healthchecks y verifica readiness/JWKS interna y publicamente. Solo entonces
   promueve `current` y conserva `previous` e `history.jsonl`.

La base inicial queda en 0.1.0 para ambos paquetes; el changeset inicial solicita
1.0.0. No ejecutar `version:access` directamente en el checkout de desarrollo
para preparar una publicacion: esa operacion pertenece a la PR automatica.

## GitHub

Workflows: `access-ci.yml`, `access-release.yml` y `deploy.yml`.
La validacion de PR/develop es independiente; main coordina CI antes de versionar
y ejecuta nuevamente los checks dentro del job que construye/publica la version.

En el environment `prod`, configurar estas variables:

| Variable | Valor / finalidad |
| --- | --- |
| `ENABLE_ACCESS_DEPLOY` | `true` solo despues de preparar host, registry y ruta publica |
| `REGISTRY_HOST` | `registry.tail41610c.ts.net` |
| `REGISTRY_USERNAME` | Cuenta de CI con permisos de publicacion para Access |
| `DEPLOY_HOST` | `192.168.100.102` |
| `DEPLOY_USER` | `access-deploy` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/opt/hemia/access` |
| `TS_CLIENT_ID` | Identidad federada OIDC autorizada para hemia-labs/access, main y prod |
| `TS_AUDIENCE` | Audience exacta de esa identidad |

Secrets de `prod`: `REGISTRY_PASSWORD`, `DEPLOY_SSH_PRIVATE_KEY` y
`DEPLOY_SSH_KNOWN_HOSTS`. Verificar la host key de apps por un canal confiable.
El workflow usa StrictHostKeyChecking y limpia las credenciales temporales.
No incluir el archivo de entorno ni la clave JWKS en secrets de build, Git o imagenes.

Configurar a nivel repositorio `RELEASE_APP_CLIENT_ID` (variable) y
`RELEASE_APP_PRIVATE_KEY` (secret) para una GitHub App instalada en Access con
Contents y Pull requests Read/write. Con ella, las PR automaticas disparan sus
checks. Sin App se usa GITHUB_TOKEN; ejecutar **Access CI** manualmente sobre la
rama `changeset-release/main` antes de fusionar esa PR.
Permitir PR creadas por Actions y exigir `Access CI / access` antes de fusionar.
Activar Release immutability antes de publicar: el flujo rechaza Releases mutables.

Tailscale debe autorizar a CI HTTPS al registry y SSH a apps. La VM debe tener
Tailscale/MagicDNS y una cuenta de registry de solo lectura en el Docker config de
`access-deploy`. El pipeline no instala ni cambia esas cuentas/configuraciones.
Verificar subject y claims del cliente OIDC antes de reutilizarlo para Access.

## Configuracion aplicada — 25 de octubre de 2026

- GitHub `prod`: secrets de SSH y registry cifrados; variables de deploy para
  `/opt/hemia/access`, `access-deploy`, puerto 8081. Environment limitado a main
  y Releases inmutables habilitadas. `ENABLE_ACCESS_DEPLOY=true`, activado y
  verificado con aprobacion explicita del usuario para futuras Releases.
- Se reutiliza la confianza OIDC existente **Hemia GitHub CI - prod**: ya admite
  `repo:hemia-labs/*:environment:prod`, con claims main y repository_owner hemia-labs.
  No se ampliaron sus permisos. La primera ejecucion de Actions verificara el
  intercambio OIDC real para Access.
- Registry: cuentas `access-ci` (publicacion) y `access-apps` (lectura), restringidas
  a `/v2/access/`. Las claves de recuperacion estan en los archivos privados
  `/root/access-ci-registry.env` y `/root/access-apps-registry.env` del CT 140.
  Nginx conserva las listas existentes para otros namespaces en platform.htpasswd;
  tener en cuenta esa lista al incorporar nuevas cuentas de otros productos.
- VM apps: usuario dedicado UID 1003, SSH restringido, Docker login de lectura,
  shared/production.env con modo 600 y clave JWKS persistente modo 400/UID 1000.
  Clave local de administracion CI: `~/.ssh/id_ed25519_access_ci_apps`.
- Produccion usa `access_prod`, copiada de `access_feature` con sus datos y seeds
  el 25 de octubre de 2026. Tiene un usuario PostgreSQL dedicado, sin privilegios
  de superusuario ni acceso a las tablas de desarrollo. Los env de produccion
  local y de la VM estan actualizados; `.env.local` y la base fuente se conservan.
  Las 23 referencias de identidad de la copia usan `https://id.hemia.cloud`.
  Conexion desde apps y migraciones verificadas: ninguna pendiente.
  Redis de produccion usa DB 1 por indicacion explicita del usuario; `.env.local`
  conserva su configuracion de desarrollo. RabbitMQ conserva su configuracion
  anterior. Todos los eventos
  outbox copiados estaban publicados.
- Identity se consume mediante `https://id.hemia.cloud`, con el cliente Access
  existente comprobado. La validacion de Legal usa
  `https://legal.hemia.cloud/v1/internal/authorization/targets/validate`, segun
  indicacion del usuario; requiere que ese servicio y su DNS esten disponibles.
- Cloudflare: CNAME Access y regla del tunel homelab-gateway hacia apps:8081.
  La regla Identity:8080 se conserva. El servicio access-docker-firewall restringe
  el puerto publicado 8081 al gateway 192.168.100.104. Se verifico la ruta HTTPS
  con un contenedor desechable y se retiro al terminar. Identity sigue saludable.
- El router LAN tenia NXDOMAIN cacheado para Access. En apps,
  `/etc/systemd/resolved.conf.d/60-hemia-cloud.conf` dirige solo la zona publica
  hemia.cloud a 1.1.1.1; se conservan MagicDNS y hemia.internal.
- Verificacion del registry: imagen OCI vacia `access/config-check:setup`;
  push CI y pull por digest como access-deploy aprobados. La cuenta de lectura
  no puede publicar, y ambas cuentas Access tienen denegado el namespace Identity.

Los workflows siguen pendientes de publicarse desde el checkout local. Esta
preparacion no ha publicado una Release de Access ni iniciado sus contenedores.

### Separacion de Identity activada

`identity_prod` ya contiene una copia de `identity_feature`, incluidos usuarios,
clientes, claves y seeds. El usuario dedicado conecta desde apps, no puede leer
las tablas de desarrollo y no hay migraciones pendientes en la imagen actualmente
desplegada. Las credenciales de Access y access-legal-validator coinciden con los
clientes copiados.

Los callbacks de Access, Billing, Console, Docs, Helpdesk y Legal y los destinos
conocidos usan sus URLs HTTPS de produccion en la copia. Por indicacion del
usuario, Balanz permanece deshabilitado: su API esta deshabilitada y sin recurso,
y se retiraron sus destinos de los tres clientes que lo utilizaban. La
configuracion local y el env activo de la VM apuntan a `identity_prod`.
Identity se reinicio con autorizacion explicita del usuario el 25 de octubre de
2026; backend y frontend estan saludables. Se verificaron la conexion y el usuario
efectivos desde el contenedor activo, readiness publico, issuer OIDC, JWKS,
introspeccion y emision de un token client_credentials con firma y claims validos.
El cliente access-legal-validator de esta version usa audiencia fija `legal-api`;
la prueba no envia `resource` porque el cliente no tiene service_destinations.
No se ejecutaron migraciones ni seeds durante el arranque ni se modificaron las
bases de desarrollo. El env anterior de Identity permanece protegido en
`shared/production.env.before-identity-prod-activation` para recuperacion.

Los respaldos y las credenciales de recuperacion permanecen privados en la VM
database, bajo `/var/lib/postgresql/backups/production-split-*/`. Los env previos
de Access estan respaldados en la VM apps; ningun secreto se guarda en Git.

## VM apps en Proxmox

Requisitos: Linux amd64, Docker Engine y Compose >= 2.30, Python 3, acceso al
registry privado y a PostgreSQL, Redis y RabbitMQ externos. Access exige Redis y
RabbitMQ en produccion; el Compose de produccion no crea esas dependencias.

Preparar un usuario dedicado con acceso a Docker, clave SSH restringida y estos
directorios/archivos:

```text
/opt/hemia/access/
  shared/
    production.env            # propietario access-deploy; modo 600
    host.json
    access-jwks-private.pem    # clave RSA persistente; modo 400 o 600
  releases/access-vX.Y.Z/
  current -> releases/access-vX.Y.Z
  previous -> releases/access-vA.B.C
  history.jsonl
```

El usuario del contenedor API es `node` (UID 1000). La clave debe ser legible por
ese UID dentro del bind mount: por ejemplo, propietario 1000:1000 y modo 400,
manteniendo shared restringido al operador. El controlador solo necesita consultar
sus metadatos; Docker realiza el mount. No regenerar la clave en cada release.
Respaldarla junto con production.env y la configuracion de lectura del registry.

`host.json`:

```json
{
  "bind_address": "192.168.100.102",
  "http_port": 8081,
  "public_url": "https://access.hemia.cloud",
  "registry_host": "registry.tail41610c.ts.net"
}
```

Configurar la ruta publica del gateway hacia `http://192.168.100.102:8081` y
limitar ese puerto al gateway/administracion. La API no publica un puerto propio:
Next.js sirve el panel y reenvia `/v1/*`, `/health/*` y `/.well-known/*` a la API.
Su acceso server-side usa `ACCESS_API_URL=http://api:3019` solo dentro de Docker.
Compose fija ACCESS_ISSUER desde public_url y monta la clave como solo lectura.
El host debe poder consultar su URL publica para completar la verificacion.

Preparar production.env a partir del archivo privado local de Access, revisando
destinos de produccion de PostgreSQL, Redis, RabbitMQ, Identity y Legal. Los
localhost del equipo de desarrollo no representan los servicios desde Docker.
Compose inyecta variables con `env_file` formato raw: valores de una sola linea,
sin comillas envolventes; `$` y `#` se conservan literalmente. El archivo nunca se
sube con la Release. Cada proceso recibe NODE_ENV=production.

## Primera puesta en servicio y migraciones

El primer merge abre la PR de version; fusionarla publica Access 1.0.0. Con una
base sin preparar, el deploy reportara pending_migrations y no promovera la release.
Aplicar migraciones explicitamente desde **Access deployment**, operacion `migrate`, tag publicado y
`backup_confirmation=I_HAVE_A_BACKUP`, despues de comprobar el backup.

Los seeds tambien son explicitos, nunca parte del deploy ni del arranque.
Seguir el orden Identity primero y Access despues; configurar el subject real
del administrador de Identity para el seed inicial de Access. Ejecutar el seed
de la imagen seleccionada como operacion manual separada con las variables de
bootstrap necesarias. Finalmente ejecutar `deploy` del mismo tag.

## Fallos, reintentos y rollback

- La VM verifica manifests y checksums antes de Docker y serializa despliegues.
- Si hay migraciones pendientes, aborta antes de sustituir el servicio actual.
- Si falla la salud de una version nueva, intenta restaurar las imagenes previas
  solo cuando el conjunto de migraciones coincide. Registra el fallo igualmente.
- `rollback` es manual y nunca revierte la base de datos. Si las migraciones
  difieren, exige confirmar revision de compatibilidad mediante acknowledge_schema.
- Si la publicacion fallo sin crear Release, corregir CI y usar **Access release**
  manualmente desde main con el tag exacto de los package.json. Se repiten todos
  los checks. Una Release existente se redespliega, no se reconstruye/sobrescribe.
- Publicacion parcial o un draft incompleto requieren inspeccion manual. No se
  borran tags, imagenes o releases automaticamente. El reemplazo puede tener corte breve.

## Verificacion local

`bun run check` ejecuta instalacion congelada, versionado, tests API/activacion,
tipos, lint, build, pruebas del controlador, builds Docker y smoke. El smoke usa
PostgreSQL/Redis/RabbitMQ y clave sintetica desechables; no lee el env local o de
produccion ni consulta servicios de la VM. Aplica migraciones/seeds solo en su
base temporal y elimina los contenedores y volumenes al terminar.
