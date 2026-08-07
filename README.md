# Sistema de Gestión Pollería — Backend Módulo 1

Producción + Stock + Transferencias. Ver [CLAUDE.md](CLAUDE.md) para contexto completo del negocio.

## Estado actual

- ✅ Backend módulo 1 completo (Flujos 1, 2 y 3)
- ✅ Frontend módulo 1 completo (carpeta `frontend/`), verificado end-to-end contra el backend real
- ✅ Typecheck limpio (`npx tsc --noEmit`)
- ✅ **83/83 tests pasando** (incluye aislamiento de sucursal, combos, precio por cantidad y eliminación de usuarios)
- ✅ Catálogo real cargado (58 productos + 4 combos) desde la carta y la planilla operativa del cliente
- ✅ DB en Neon, migrada y seedeada — proyecto nuevo, ver CLAUDE.md §11 ("Base Neon NUEVA")

**Módulo 1 completo, auditado y con los 3 hallazgos de la auditoría corregidos.** Ver CLAUDE.md §4.1, §11 y §12 para el detalle.

## Despliegue en la nube (prueba)

Instrucciones completas paso a paso en [DEPLOY.md](DEPLOY.md). Resumen del estado actual:

- **Backend**: Railway, servicio conectado a `volbrunti/polleria-sistema` rama `feature/modulo-2`, auto-deploy en cada push. Región **US East (Virginia)**. `deploy:start` corre `prisma migrate deploy` antes de levantar el server, así que las migraciones se aplican solas en cada deploy.
- **Base de datos**: Neon, proyecto en **US East (Virginia, `us-east-1`)** — misma región que Railway para minimizar latencia.
- **Frontend**: Cloudflare Pages, conectado al mismo repo/rama, root directory `frontend/`, build `npm run build`, output `dist/`.
- **Variables de entorno**: viven únicamente en el panel de cada plataforma (Railway → Variables, Cloudflare Pages → Environment variables), **nunca en el repo**. La lista completa de qué cargar está en DEPLOY.md §2.2 y §3.2.
- **Volumen de `/data`**: pendiente de confirmar que esté montado en Railway — sin eso las fotos de remito se pierden en cada redeploy (ver DEPLOY.md §2.3).

> Este es el despliegue de **prueba**, no el de producción — ver la nota al principio de DEPLOY.md sobre la decisión Render + Neon para producción.

### Pendiente para terminar este despliegue (2026-08-07)

- [ ] Confirmar que las variables de Railway están cargadas (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`, `DIR_UPLOADS=/data/uploads`, `ADMIN_INICIAL_USUARIO`, `ADMIN_INICIAL_PASSWORD`).
- [ ] Montar el volumen en `/data` en Railway (canvas del proyecto → click derecho en el servicio → Attach Volume).
- [ ] Completar a mano el **Healthcheck Path** (`/api/salud`) en Railway → Settings → Deploy — el builder mostraba "Railpack" en vez de "Nixpacks", así que no está confirmado que esté leyendo `railway.json` solo.
- [ ] Terminar de conectar y deployar el frontend en Cloudflare Pages (root `frontend/`, build `npm run build`, output `dist/`, variable `VITE_API_URL` = URL del backend de Railway).
- [ ] Una vez tengas la URL de Cloudflare Pages, cargar `ORIGENES_PERMITIDOS` en Railway con esa URL (sin barra final) — **el backend no arranca en producción sin esto**, es el único paso que le falta para levantar.
- [ ] Sembrar el admin inicial contra la Neon de Virginia (`npm run seed` con `DATABASE_URL`, `NODE_ENV=production` y `ADMIN_INICIAL_PASSWORD`, ver DEPLOY.md §2.4). Usuario/contraseña generados en esta sesión: guardados en tu gestor de contraseñas, no están en el repo.
- [ ] Verificar el checklist de DEPLOY.md §4: `/api/salud`, login, refresh de sesión, abrir turno + cargar pedido, alerta en vivo por WebSocket.

## Base de datos

Neon Postgres (free tier), proyecto `polleria` (org Volbrunti). Dos bases: `polleria` (dev, seedeada) y `polleria_test` (integración, la limpian y siembran los propios tests en cada corrida). Credenciales en `.env` (no versionado — pedir a quien tenga acceso a la cuenta Neon si hace falta).

Nota de latencia: el free tier suspende el compute agresivamente entre queries y no se puede ajustar sin plan pago. Por eso `npm test` tarda ~4 minutos (cada archivo de test reconecta en frío) — es esperable, no es un bug.

```powershell
npx prisma migrate dev --name <nombre>   # nueva migración tras cambiar schema.prisma
npm run seed                              # reseedea polleria (dev)
npm test                                  # unitarios + integración (usa DATABASE_URL_TEST)
npm run dev                               # levanta el server en :3000
```

## Usuarios del seed

| username | password | rol |
|---|---|---|
| admin | admin123 | ADMINISTRADOR |
| ariel / eliana | socio123 | SOCIO |
| encargado | encargado123 | ENCARGADO |
| cajero | cajero123 | CAJERO |
| produccion | produccion123 | PRODUCCION |

(Passwords de desarrollo — cambiar antes de producción.)

## Estructura

```
src/
├── app.ts                 # buildApp() — registra plugins y rutas (usado por tests)
├── server.ts              # arranque + Socket.io (sala de admins para alertas)
├── config.ts
├── lib/                   # prisma, errores de negocio, helper de auditoría
├── plugins/auth.ts        # JWT + requerirRoles (RBAC)
└── modules/
    ├── auth/              # login, refresh (cookie httpOnly), logout
    ├── usuarios/          # CRUD solo admin
    ├── productos/         # catálogo + precios (historial, nunca se pisa)
    ├── proveedores/
    ├── sucursales/
    ├── stock/             # stock = SUM(MovimientoStock)
    ├── ingresos/          # Flujo 1 — líneas = lotes de ingreso trazables
    ├── fichas-tecnicas/   # versionado: nueva versión desactiva la anterior
    ├── produccion/        # Flujo 2 — cálculo ciego de rendimiento + alertas
    ├── transferencias/    # Flujo 3 — recepción ciega, discrepancias
    ├── auditoria/         # inmutable, solo lectura admin/socio
    └── alertas/           # solo admin, in-app + WebSocket
```

## Control ciego (invariante del sistema)

- El backend **nunca** responde `unidadesEsperadas` / `desvioPct` / `alertaDisparada` al rol PRODUCCION.
- El receptor de una transferencia **nunca** ve `cantidadEnviada` ni `diferencia` (ni antes ni después de confirmar).
- La comparación de recepción responde solo "coincide / no coincide".
- Hay tests de no-filtración que inspeccionan el JSON crudo de las respuestas (`tests/integration/rbac-y-campos-ciegos.test.ts`).

## Pendientes conocidos

- Excel de fichas técnicas: llegó como planilla de costos ("ANALISIS COSTOS", 2026-07-13) — porciones reales ya cargadas en las fichas del seed. El cliente confirmó por WhatsApp (2026-07-17) desperdicio esperado 0% en todas las fichas (las porciones ya lo incluyen) — a calibrar con lotes reales. La receta real de la empanada de pollo llegó el 2026-07-18 y ya está en el seed. Ver CLAUDE.md §11 (pregunta pendiente: peso real de una milanesa individual; plan de costeo Fases B/C).
