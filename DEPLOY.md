# Subir el sistema a la nube

> **Estado**: esto es para **probar en la nube**, no para producción. La decisión de producción sigue siendo **Render + Neon** (ver la investigación de hosting del 5/8: Railway estuvo caído 8 horas el 19/5/2026 por una suspensión de cuenta de GCP que se propagó a todas sus regiones, y un POS sin modo offline hereda el uptime del proveedor).
>
> Todo lo que sigue es portable salvo un archivo: `railway.json`. Al mover a Render se reemplaza por `render.yaml` y el resto queda igual.

---

## 0. Antes de empezar

Necesitás:

- El repo en GitHub (`volbrunti/polleria-sistema`), rama `main`.
- Una cuenta en Railway y otra en Cloudflare (o Vercel) para el frontend.
- El proyecto de Neon ya creado.

---

## 1. Base de datos (Neon)

Usá una **branch nueva** de Neon para la prueba, no la de desarrollo — así podés romper todo sin miedo:

1. En Neon → *Branches* → *Create branch*, nombrala `nube-prueba`.
2. Copiá el connection string **pooled** (el que dice `-pooler` en el host). Es el que va en `DATABASE_URL`.

> La región de Neon **no se puede cambiar después**. Si esta base va a terminar siendo la real, creala directamente en `aws-us-east-1` (Virginia) para que quede junto al backend.

---

## 2. Backend (Railway)

### 2.1 Crear el servicio

*New Project* → *Deploy from GitHub repo* → elegí el repo y la rama `main`.

Railway lee `railway.json` del repo, así que el build y el arranque ya quedan configurados:

- **build**: `npm run build`
- **start**: `npm run deploy:start` — corre `prisma migrate deploy` y recién ahí levanta el server, así que **las migraciones se aplican solas en cada deploy**.
- **healthcheck**: `/api/salud`

### 2.2 Variables de entorno

En *Variables*, cargá:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | El connection string pooled de Neon (paso 1) |
| `JWT_SECRET` | Un secreto largo y aleatorio |
| `JWT_REFRESH_SECRET` | **Otro distinto** del anterior |
| `NODE_ENV` | `production` |
| `NPM_CONFIG_PRODUCTION` | `false` — **necesaria pese al nombre**, ver nota abajo |
| `ORIGENES_PERMITIDOS` | La URL del frontend, sin barra final (la completás en el paso 3.2) |
| `R2_ACCOUNT_ID` | El Account ID de Cloudflare (paso 2.3) |
| `R2_ACCESS_KEY_ID` | Del token de API R2 que generás en el paso 2.3 |
| `R2_SECRET_ACCESS_KEY` | Ídem |
| `R2_BUCKET` | Nombre del bucket (paso 2.3) |
| `R2_URL_PUBLICA` | La URL pública del bucket, sin barra final (paso 2.3) |
| `ADMIN_INICIAL_PASSWORD` | La contraseña del **único** usuario con el que arranca el sistema |
| `ADMIN_INICIAL_USUARIO` | Opcional, por defecto `admin` |

Para generar los secretos:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`PORT` la inyecta Railway sola — no la cargues.

> **`NPM_CONFIG_PRODUCTION=false` es imprescindible pese al nombre.** Con `NODE_ENV=production` puesto, Nixpacks instala el proyecto con `--omit=dev` — y ahí vive `typescript`, así que el build (`tsc`) rompe. Por cómo se resuelve el árbol de dependencias, la mayoría de las devDependencies sobreviven igual (quedan enganchadas a alguna dependencia de producción), pero al menos `@types/jsonwebtoken` no, y el build falla con `TS7016: Could not find a declaration file for module 'jsonwebtoken'`. Esta variable le dice a `npm` que instale las devDependencies de todas formas — es independiente de `NODE_ENV`, que sigue controlando el comportamiento de la app en runtime.

> Con `NODE_ENV=production` el server **no arranca** si falta `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ORIGENES_PERMITIDOS` o cualquiera de las 5 variables de R2. Es a propósito: es preferible que no levante a que levante perdiendo datos o insegura.

### 2.3 Fotos de remito (Cloudflare R2)

El disco del contenedor de Railway se borra en cada deploy, así que las fotos van directo a un bucket de R2 (API S3-compatible) en vez de a un volumen — ya queda hecho así de una vez, en vez de resolverlo después para producción.

1. En el dashboard de Cloudflare → **R2 Object Storage** → *Create bucket*. Nombralo (ej: `polleria-remitos`). Anotá el **Account ID** que aparece en la URL del dashboard (`dash.cloudflare.com/<account-id>/r2`) — es `R2_ACCOUNT_ID`.
2. Adentro del bucket → *Settings* → **Public access** → habilitalo (vía subdominio `r2.dev` que te da Cloudflare, o un dominio propio). Copiá esa URL pública — es `R2_URL_PUBLICA`. El bucket queda público a propósito: el nombre de cada foto lleva bytes aleatorios (no es adivinable), mismo nivel de protección que tenía el disco local servido sin auth.
3. R2 → *Manage API tokens* → *Create API token* → permisos **Object Read & Write**, alcance limitado a ese bucket. Te da un **Access Key ID** y un **Secret Access Key** — son `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. El secreto se muestra **una sola vez**: copialo antes de cerrar la ventana.
4. Cargá las 5 variables en Railway (tabla de arriba).

No hace falta ningún volumen ni `DIR_UPLOADS` en este esquema — esa variable solo se usa como fallback si corrés el backend en local sin credenciales de R2.

### 2.4 Sembrar la base

Una sola vez, desde tu máquina, apuntando a la base de la nube:

```bash
DATABASE_URL="<connection string de Neon>" NODE_ENV=production ADMIN_INICIAL_PASSWORD="<una clave fuerte>" npm run seed
```

Esto carga sucursales, catálogo, precios y fichas técnicas, y crea **un solo usuario**: el administrador inicial, con la contraseña que le pasaste. Con `NODE_ENV=production` el seed **aborta si no le das `ADMIN_INICIAL_PASSWORD`**, justamente para que nadie termine con una clave adivinable.

Desde ahí, entrás como ese admin y creás el resto (Pablo, encargados, cajeros, producción) en **Admin → Usuarios**, cada uno con su usuario y contraseña.

> Los usuarios de demo con claves conocidas (`cajero/cajero123`, etc.) se siembran **solo fuera de producción**. Si alguna vez los querés en un ambiente de prueba, `SEED_DEMO=true`.
>
> Volver a correr el seed **no pisa** la contraseña del admin: si te equivocaste, cambiala desde el panel de Usuarios.

---

## 3. Frontend

### 3.1 Build

El frontend es estático. Se construye apuntando al backend:

```bash
cd frontend
VITE_API_URL="https://<tu-backend>.up.railway.app" npm run build
```

Queda en `frontend/dist/`.

> **No** definas `VITE_MOSTRAR_DEMO`. Los botones de "entrar directo como Admin" llevan las contraseñas dentro del bundle: en una URL pública son un acceso de administrador para cualquiera. Solo activalo si vas a mostrar la demo y sabés que la URL no circula.

### 3.2 Publicar (Cloudflare Workers — reemplazó a Pages)

Cloudflare unificó Pages dentro de Workers: *Compute → Create application → Workers → Connect to Git* → elegí el repo y la rama.

En "Set up your application":
- **Build command**: `npm run build` (ya viene precargado)
- **Deploy command**: `npx wrangler deploy` (ya viene precargado — lee `frontend/wrangler.jsonc`, agregado al repo)
- **Advanced settings** → **Root directory**: `frontend` (el repo es un monorepo; sin esto busca el build en la raíz y no lo encuentra)
- **Advanced settings** → **Environment variables** (de build, no runtime): `VITE_API_URL` = la URL del backend

`frontend/wrangler.jsonc` ya define `assets.directory: "./dist"` y `not_found_handling: "single-page-application"` (necesario: es una SPA de React Router — sin eso, recargar en `/admin/dashboard` da 404).

Cuando tengas la URL del frontend (`*.workers.dev` o el dominio que elijas), volvé a Railway y ponela en `ORIGENES_PERMITIDOS`. Sin eso, el navegador bloquea todas las llamadas por CORS.

---

## 4. Verificar que quedó bien

En este orden:

1. `https://<backend>/api/salud` devuelve `{"ok":true}`.
2. Entrás al frontend y **el login con usuario y contraseña funciona**.
3. Recargás la página estando logueado y **seguís adentro** (esto prueba que la cookie de refresh cruza entre los dos dominios — ver la advertencia de abajo).
4. Abrís un turno y cargás un pedido: prueba que la base y las migraciones están bien.
5. Con el admin abierto en otra pestaña, generás una alerta: prueba que el WebSocket conectó.

---

## 5. Dominio propio (recomendado, resuelve el problema de las cookies)

Con el backend en `*.up.railway.app` y el frontend en `*.workers.dev` son sitios
distintos, así que la cookie de refresh viaja como *third-party*: Chrome la deja pasar,
pero **Safari la bloquea por defecto** — en un iPad la sesión se corta cada 15 minutos,
cuando vence el access token. Poner los dos bajo subdominios del mismo dominio propio
resuelve esto de raíz: dejan de ser sitios distintos para el navegador.

**Reparto**: `tudominio.com` → frontend, `api.tudominio.com` → backend,
`fotos.tudominio.com` → bucket público de R2.

1. **Cloudflare** → *Add a domain* → plan Free. Te da dos nameservers.
2. **En el registrador** (Hostinger u otro) → reemplazar los nameservers actuales por
   los dos de Cloudflare. Tarda entre 1 y 24 h en propagar; Cloudflare avisa por mail
   cuando el dominio pasa a **Active**.
3. **Frontend**: Cloudflare → Workers → tu app → *Settings → Domains & Routes* → *Add
   Custom Domain* → `tudominio.com`. Certificado y registro DNS se crean solos.
4. **Backend**: Railway → *Settings → Networking* → *Custom Domain* → `api.tudominio.com`.
   Railway da un destino CNAME; en Cloudflare DNS creá ese CNAME con **Proxy status: DNS
   only** (nube gris). *Ojo*: con el proxy naranja activado y SSL en modo "Flexible" se
   arma un bucle de redirecciones — es el error más común de esta combinación. Si más
   adelante querés el proxy, primero poné SSL/TLS en *Full (strict)*.
5. **R2**: bucket → *Settings → Public access* → *Connect custom domain* →
   `fotos.tudominio.com`. **No desactivar el acceso `r2.dev`**: las fotos ya subidas
   guardan la URL completa en la base (`IngresoMercaderia.fotoRemitoUrl`), así que siguen
   apuntando ahí para siempre — apagarlo rompe los remitos viejos.
6. **Variables**: `ORIGENES_PERMITIDOS=https://tudominio.com` y
   `R2_URL_PUBLICA=https://fotos.tudominio.com` en Railway; `VITE_API_URL=https://api.tudominio.com`
   en Cloudflare Workers (variable de build). Redeploy de los dos — el frontend necesita
   rebuild sí o sí, porque las `VITE_*` quedan incrustadas en el bundle al compilar.

**Cambio de código que va junto con esto**: `sameSite` de la cookie de refresh pasa de
`'none'` a `'lax'` (`src/modules/auth/auth.routes.ts`) — es más seguro (protege contra
CSRF) y ya no depende de que el navegador acepte cookies de terceros. **Solo funciona una
vez que frontend y backend están bajo el mismo dominio propio.** Si se despliega este
cambio mientras todavía está en `*.up.railway.app` / `*.workers.dev`, el navegador
directamente no manda la cookie entre esos dos sitios y el refresh de sesión falla en
silencio (el login funciona, pero la sesión no sobrevive a un recargo de página). No
mergear/deployar este cambio hasta que el dominio esté en Active y las variables del
paso 6 ya estén cargadas.

---

## Lo que hay que tener en cuenta

**El plan gratis de Railway duerme el servicio.** Si el backend se suspende por
inactividad, la primera request después tarda. Para una prueba está bien; para una caja
abierta 12 horas, no.

---

## Cuando pasemos a producción (Render)

Lo único que cambia:

1. Borrar `railway.json`, agregar `render.yaml` con los mismos comandos (`npm run build` / `npm run deploy:start`, healthcheck en `/api/salud`).
2. Crear el servicio en **Virginia**, la misma región que Neon.
3. Dominio propio con subdominios para backend y frontend, que además resuelve el problema de las cookies.
4. Backups: PITR de 7 días + `pg_dump` semanal fuera de la plataforma.

Las variables de entorno son exactamente las mismas.
