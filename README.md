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

- Excel de fichas técnicas: llegó como planilla de costos ("ANALISIS COSTOS", 2026-07-13) — porciones reales ya cargadas en las fichas del seed; desperdicio esperado sigue siendo estimación a calibrar con lotes reales. Ver CLAUDE.md §11 (preguntas para Pablo + plan de costeo Fases B/C).
