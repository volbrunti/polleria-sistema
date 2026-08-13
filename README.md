# Sistema de Gestión Pollería "Limón & Chimi"

Backend (Node + TypeScript + Fastify + Prisma + PostgreSQL) y frontend (React + Vite +
Tailwind, PWA) para una pollería de Córdoba con planta de producción central y dos locales
de venta.

> **El contexto completo del negocio, las reglas innegociables, el modelo de datos y el
> estado del proyecto están en [CLAUDE.md](CLAUDE.md).** Leelo antes de tocar código — este
> README solo explica cómo correr las cosas.
>
> Para desplegar: [DEPLOY.md](DEPLOY.md).

## Estado

Los tres módulos están completos y auditados: **Producción + Stock + Transferencias**,
**POS + Caja y Turnos**, y **Reportes + Dashboard**. Todo vive en `main`.

Suite: **317 tests en 22 archivos**. Typecheck limpio en ambos proyectos.

Lo único que falta para producción está listado en [CLAUDE.md §11](CLAUDE.md#11-pendientes-y-decisiones-abiertas)
— principalmente probar las comanderas contra el hardware real y cargar los secretos de
producción.

## Correr en desarrollo

Hacen falta dos terminales. El backend en `:3000` y el frontend en `:5173` (Vite proxea
`/api` y `/socket.io` al backend, así que en desarrollo todo es same-origin).

```bash
npm install && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

Necesitás un `.env` en la raíz con `DATABASE_URL` y `DATABASE_URL_TEST` apuntando a Neon
(ver `.env.example`). El archivo no está versionado — pedíselo a quien tenga acceso a la
cuenta.

## Base de datos

Neon PostgreSQL. Dentro de la misma branch conviven **dos bases separadas**: `neondb`
(desarrollo, seedeada) y `polleria_test` (integración — la limpian y siembran los propios
tests en cada corrida).

```bash
npx prisma migrate dev --name <nombre>
```

```bash
npm run seed
```

```bash
npm test
```

> **Cada base tiene su propio historial de migraciones.** Aplicar una migración en `neondb`
> no la aplica en `polleria_test`. Si los tests fallan con `The column X does not exist`,
> es esto — no un bug del código. Ver [CLAUDE.md §12](CLAUDE.md#12-reglas-de-implementación)
> reglas 16 a 18.

Para correr solo una parte de la suite:

```bash
npm run test:unit
```

```bash
npx vitest run tests/integration/pedidos.test.ts
```

> El free tier de Neon suspende el compute entre queries, así que la suite completa tarda
> ~6 minutos (cada archivo reconecta en frío). Es esperable.

## Usuarios del seed

Solo para desarrollo — **nunca correr este seed contra producción**.

| username | password | rol |
|---|---|---|
| `admin` | `admin123` | ADMINISTRADOR |
| `ariel` / `eliana` / `ema` | `socio123` | SOCIO |
| `encargado` | `encargado123` | ENCARGADO |
| `cajero` | `cajero123` | CAJERO |
| `produccion` | `produccion123` | PRODUCCION |

En la pantalla de login aparecen como accesos rápidos, gateados por
`import.meta.env.DEV || VITE_MOSTRAR_DEMO === 'true'`. En un build de producción **no se
muestran** — verificá que `VITE_MOSTRAR_DEMO` no esté seteada en el panel del hosting.

## Estructura

El mapa completo de módulos y carpetas está en
[CLAUDE.md §9](CLAUDE.md#9-mapa-del-código). En resumen:

```
prisma/      schema + migraciones + seed
src/         backend — un módulo por dominio bajo src/modules/
frontend/    React SPA (PWA)
tests/       unit/ (sin DB) e integration/ (contra polleria_test)
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Backend con recarga en caliente (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Corre el build |
| `npm run deploy:start` | `prisma migrate deploy` + arranque (lo usa Railway) |
| `npm run seed` | Reseedea la base de desarrollo |
| `npm test` | Suite completa |
| `npm run test:unit` / `test:int` | Solo unitarios / solo integración |
