# Checklist ANTES de subir a producción

> Lista de tareas obligatorias previas al deploy (Railway backend + Vercel frontend).
> Nada de esto es un bug hoy: en desarrollo local todo funciona. Pero si se
> despliega sin resolver estos puntos, HAY errores o pérdida de datos en producción.
> Revisar ítem por ítem y tildar antes de dar de alta a los clientes.

## Bloqueantes (el sistema pierde datos o queda inseguro si se saltean)

- [ ] **Fotos de remito → almacenamiento externo (S3 / Cloudflare R2 / Cloudinary)**
  - Hoy `POST /api/ingresos/foto` guarda en disco local (`uploads/remitos/`).
  - Railway tiene filesystem EFÍMERO: cada deploy o reinicio borra todos los archivos.
  - Consecuencia si no se hace: las fotos se suben bien pero desaparecen en el
    próximo deploy — el ingreso queda en DB apuntando a una imagen rota.
  - Cambio chico (~15 min) una vez elegido el proveedor. R2 y Cloudinary tienen
    free tier que sobra para fotos de remitos.
  - Código a tocar: `src/modules/ingresos/` (handler de subida de foto).

- [x] **Cookie de refresh `sameSite: 'strict'`** — resuelto (2026-07-25)
  - Rompía el refresh silencioso de sesión si el frontend (Vercel) y el backend
    (Railway) quedan en DOMINIOS DISTINTOS.
  - `src/modules/auth/auth.routes.ts` ahora usa `sameSite: 'none'` en producción
    (junto con `secure: true`, ya atado a `esProduccion`) y `'lax'` en desarrollo.
  - Pendiente solo verificar en vivo contra un deploy real con dominios separados
    (Vercel + Railway) una vez desplegado — no se puede probar sin esa infra.

- [x] **Migraciones al día en la branch de Neon `modulo-2-dev`** — verificado (2026-07-26)
  - Se corrió `prisma migrate deploy` contra `neondb` (dev) y contra `polleria_test`
    (son DOS bases separadas dentro de la misma branch de Neon — cada una necesita
    su propio `migrate deploy`, no alcanza con correrlo una vez).
  - Las 11 migraciones estaban al día en `neondb`; a `polleria_test` le faltaban 4
    (quedó desactualizada desde la Fase 9 del Módulo 2). Ya aplicadas, sin drift.
  - Suite completa corrida contra `polleria_test`: **202/202 tests pasan**.
  - Gotcha para quien retome esto: después de `git pull`/`git am` con cambios de
    schema, hace falta correr `npx prisma generate` a mano — no hay `postinstall`
    que lo dispare solo. Si no, el cliente de Prisma queda desactualizado y tira
    `Unknown argument <campo>` aunque la migración ya esté aplicada en la DB.

- [ ] **Variables de entorno en Railway**
  - `JWT_SECRET` y `JWT_REFRESH_SECRET`: OBLIGATORIAS y distintas entre sí,
    generadas al azar (no reutilizar las de dev). El server aborta el arranque
    en `NODE_ENV=production` si faltan (validación en `src/config.ts`) — eso
    está bien, pero hay que cargarlas.
  - `DATABASE_URL`: la de Neon PRODUCCIÓN (no la de dev ni la de test).
  - `NODE_ENV=production`.

- [ ] **Usuarios y contraseñas del seed**
  - El seed de desarrollo crea usuarios con contraseñas CONOCIDAS
    (`admin/admin123`, `produccion/produccion123`, etc.).
  - NUNCA correr ese seed contra la DB de producción. Para producción: crear
    solo los usuarios reales con contraseñas fuertes elegidas por cada persona.
  - Los datos de catálogo/fichas/precios del seed SÍ sirven — separar esa carga
    de la de usuarios cuando llegue el momento (script de carga inicial de prod).

## Importantes (no pierden datos, pero se notan)

- [ ] **Ícono PWA real**: hoy es un SVG placeholder con "L&C". Falta arte de marca
  (PNG 192×192 y 512×512) en `frontend/public/` + actualizar `vite.config.ts`.
  Sin esto la app instalada en el celu de los empleados se ve genérica.

- [ ] **CORS y origen de Socket.io**: revisar que el backend acepte el dominio real
  del frontend en producción (hoy el proxy de Vite hace todo same-origin en dev,
  así que este problema no se ve hasta desplegar).

- [ ] **Migraciones**: el deploy debe correr `prisma migrate deploy` (nunca
  `migrate dev` ni `db push` en producción).

- [ ] **HTTPS**: verificar `secure: true` en cookies cuando haya TLS (Railway y
  Vercel lo dan por defecto, pero la cookie debe declararlo).

## Notas de desarrollo (no afectan producción)

- La branch de Neon activa mientras se trabaja en `feature/modulo-2` es
  `modulo-2-dev` (`ep-lingering-butterfly-aczyt7qm-pooler.sa-east-1.aws.neon.tech`),
  con `neondb` (dev) y `polleria_test` (tests) como bases separadas — ambas
  migradas y verificadas al 2026-07-26. La branch `production`
  (`ep-bold-flower-acc36pom-pooler...`) es la que ve el cliente en `main` con
  el Módulo 1; queda comentada en `.env` mientras tanto.
- Para correr los tests de integración SIN Neon: se puede levantar un Postgres
  efímero local con `initdb` — cluster descartable con auth trust, `prisma
  migrate deploy` y listo. Verificado el 2026-07-18: 83/83 tests pasan así.
