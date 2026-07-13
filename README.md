# Sistema de Gestión Pollería — Backend Módulo 1

Producción + Stock + Transferencias. Ver [CLAUDE.md](CLAUDE.md) para contexto completo del negocio.

## Estado actual

- ✅ Backend módulo 1 completo (Flujos 1, 2 y 3)
- ✅ Frontend módulo 1 completo (carpeta `frontend/`), verificado end-to-end contra el backend real
- ✅ Typecheck limpio (`npx tsc --noEmit`)
- ✅ **78/78 tests pasando** (incluye aislamiento de sucursal, combos y precio por cantidad, agregados el 2026-07-13)
- ✅ Catálogo real cargado (58 productos + 4 combos) desde la carta y la planilla operativa del cliente
- ✅ DB en Neon, migrada y seedeada — proyecto nuevo, ver CLAUDE.md §11 ("Base Neon NUEVA")

**Módulo 1 completo, auditado y con los 3 hallazgos de la auditoría corregidos.** Ver CLAUDE.md §4.1, §11 y §12 para el detalle.

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

- Excel de fichas técnicas reales del cliente → hoy seeds con datos de ejemplo. Al llegar: cargar fichas reales vía `POST /api/fichas-tecnicas` o ajustar seed.
- Frontend (React + Vite): fase posterior, recién cuando el backend esté probado.
