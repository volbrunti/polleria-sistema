# Subir el sistema a la nube

> **Estado**: esto es para **probar en la nube**, no para producción. La decisión de producción sigue siendo **Render + Neon** (ver la investigación de hosting del 5/8: Railway estuvo caído 8 horas el 19/5/2026 por una suspensión de cuenta de GCP que se propagó a todas sus regiones, y un POS sin modo offline hereda el uptime del proveedor).
>
> Todo lo que sigue es portable salvo un archivo: `railway.json`. Al mover a Render se reemplaza por `render.yaml` y el resto queda igual.

---

## 0. Antes de empezar

Necesitás:

- El repo en GitHub (`volbrunti/polleria-sistema`), rama `feature/modulo-2`.
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

*New Project* → *Deploy from GitHub repo* → elegí el repo y la rama `feature/modulo-2`.

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
| `ORIGENES_PERMITIDOS` | La URL del frontend, sin barra final (la completás en el paso 3.2) |
| `DIR_UPLOADS` | `/data/uploads` |
| `ADMIN_INICIAL_PASSWORD` | La contraseña del **único** usuario con el que arranca el sistema |
| `ADMIN_INICIAL_USUARIO` | Opcional, por defecto `admin` |

Para generar los secretos:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`PORT` la inyecta Railway sola — no la cargues.

> Con `NODE_ENV=production` el server **no arranca** si falta `JWT_SECRET`, `JWT_REFRESH_SECRET` u `ORIGENES_PERMITIDOS`. Es a propósito: es preferible que no levante a que levante inseguro.

### 2.3 Volumen para las fotos de remito

El disco del contenedor se borra en cada deploy. En *Settings* → *Volumes*, montá uno en `/data`. Eso es lo que hace que `DIR_UPLOADS=/data/uploads` tenga sentido.

Si no lo hacés, las fotos de remito se pierden cada vez que redeployás. Para producción esto va a S3/R2 de todas formas.

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

## Lo que hay que tener en cuenta

**Las cookies entre dominios distintos son el riesgo principal.** Con el backend en `*.up.railway.app` y el frontend en `*.pages.dev` son sitios distintos, así que la cookie de refresh viaja como *third-party*. Chrome hoy la deja pasar, pero **Safari la bloquea por defecto** — y si el cliente prueba desde un iPad, la sesión se va a cortar cada 15 minutos, cuando vence el access token.

La solución de fondo es poner los dos bajo el mismo dominio (`api.midominio.com` y `app.midominio.com`), y ahí la cookie deja de ser de terceros. Para la prueba, avisá de probar en Chrome/Android.

**El volumen de Railway es de un solo nodo.** Si algún día escalás a más de una instancia, las fotos dejan de verse desde la otra. Es otra razón para mover los archivos a R2/S3 antes de producción.

**El plan gratis de Railway duerme el servicio.** Si el backend se suspende por inactividad, la primera request después tarda. Para una prueba está bien; para una caja abierta 12 horas, no.

---

## Cuando pasemos a producción (Render)

Lo único que cambia:

1. Borrar `railway.json`, agregar `render.yaml` con los mismos comandos (`npm run build` / `npm run deploy:start`, healthcheck en `/api/salud`).
2. Crear el servicio en **Virginia**, la misma región que Neon.
3. Mover las fotos de remito a R2 (reemplaza el volumen y `DIR_UPLOADS`).
4. Dominio propio con subdominios para backend y frontend, que además resuelve el problema de las cookies.
5. Backups: PITR de 7 días + `pg_dump` semanal fuera de la plataforma.

Las variables de entorno son exactamente las mismas.
