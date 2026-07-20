# HANDOFF PARA AUDITORÍA — MÓDULO 2 (POS + Caja y Turnos)

> **Para el auditor**: este documento es tu punto de entrada. El contexto de negocio
> completo está en `CLAUDE.md` (raíz) y `CLAUDE-MODULO-2.md` (spec del módulo 2, con
> el registro de decisiones en su §0). Leelos antes de auditar. Acá va: qué se
> construyó, dónde vive, qué invariantes NO pueden romperse, cómo correr todo, y qué
> se verificó ya (para que no repitas trabajo sino que busques lo que se nos escapó).

## 1. Alcance de lo construido

**Rama**: `modulo-2` (tracking de `origin/feature/modulo-2`). NO está en `main`.

### Backend (Fases 0-5, commits `8b66b17`..`8f40a11`, autor Facundo)
- **Schema** (migración `20260717195901_modulo_2_turnos_pedidos_caja` + `item_pedido_monto_total`): `Turno`, `Arqueo`, `BloqueoDeTurno`, `ClaveDeEmergencia`, `Pedido`, `ItemDePedido`, `Pago`, `Atencion`, `GastoDeCaja`, `RetiroDeCaja`, `EventoMarcadoPollo`, `TicketCocina`, `ConfiguracionStockMinimo`. IDs enteros autoincrement (NO cuid como decía el borrador de spec — decisión: consistencia con módulo 1).
- **`src/modules/turnos/`**: apertura/cierre con arqueo doble ciego server-side, bloqueo por discrepancia SOLO en apertura (el cierre alerta pero nunca bloquea), desbloqueo remoto, claves de emergencia (8 chars sin ambiguos, un solo uso, 10 min, generar nueva invalida la anterior, error genérico `CLAVE_INVALIDA` para todo fallo), serializers ciegos por rol.
- **`src/modules/pedidos/`**: el pedido nace confirmado (`POST /pedidos` = confirmar: descuenta stock, congela precios, emite ticket — todo en una transacción). `ItemDePedido.montoTotal` congela el TOTAL de línea (con tabla de volumen N unidades ≠ N × unitario). Precio por volumen: tier exacto o descomposición greedy desc. Pollo (entero=1, medio=0.5, suelto o en combo) descuenta del producto MARCADO. Cobro con medios combinados, vuelto SOLO del efectivo, pago EFECTIVO persistido NETO de vuelto. Estados §4.4 con matriz de transiciones validada. Anulación repone stock y guarda snapshot completo en auditoría. Reasignación no toca stock. Comandera mock (`comandera.ts`) → `TicketCocina` con flag `impreso`.
- **`src/modules/caja/`**: atenciones (mismo resolvedor de stock que ventas), gastos (solo EFECTIVO/MP, "OTRO" exige detalle), retiros (enum cerrado ARIEL/ELIANA/EMA), marcado de pollos (−fresco/+marcado atómico con validación), costo cero directo (DESPERDICIO_QUEMADO mata stock; RETORNO_A_PRODUCCION mueve el mismo producto del local a Producción).
- **`src/modules/stock-minimo/`**: config por producto+sucursal (solo admin), avisos adjuntos a cada venta que deja stock bajo mínimo (se repiten en CADA venta), `Alerta STOCK_MINIMO` solo al CRUZAR el umbral, evaluación dentro de la misma transacción del descuento.

### Backend (agregados 2026-07-20, junto al frontend)
- `GET /api/pedidos/mas-vendidos` — ranking por sucursal desde `ItemDePedido` (pedidos no anulados), ordena la grilla del POS (§4.1). Roles operativos.
- `GET /api/productos/precios-vigentes` — tablas de precio vigentes de TODOS los productos en bulk. **Legible por CAJERO/ENCARGADO** (decisión: el precio de VENTA no es dato ciego — el cajero se lo cobra al cliente; el historial de precios sigue solo ADMIN/SOCIO).

### Frontend (Fases 6-8, commit `c68cc07`, 2026-07-20)
- **`frontend/src/api/`**: `turnos.ts`, `pedidos.ts`, `caja.ts`, `stockMinimo.ts` + tipos módulo 2 en `types.ts` + bulk de precios en `productos.ts`.
- **`frontend/src/lib/precios.ts`**: espejo client-side del cálculo greedy de precio por volumen (para el total en vivo del carrito). La AUTORIDAD es el backend al confirmar.
- **`frontend/src/features/local/caja/`** (lado cajero, tablet):
  - `CajaTab.tsx` — gate de turno: sin turno → apertura; BLOQUEADO → pantalla de bloqueo; ABIERTO → POS con subnav (Vender/Pedidos/Caja/Cerrar turno). Polling de turno activo cada 20 s (así llega el desbloqueo remoto).
  - `AperturaTurno.tsx` / `CierreTurno.tsx` — arqueo doble ciego (efectivo + pollos marcados), pantalla neutral SIN referencias. El cierre muestra SOLO unidades vendidas + pollos restantes y cierra la sesión.
  - `PantallaBloqueada.tsx` — mensaje genérico (sin montos, sin decir cuál de los DOS arqueos falló), botón reintentar, opción DISCRETA "Tengo una clave" (chica, abajo a la derecha).
  - `POS.tsx` — grilla por categorías ordenada por más vendidos (y las categorías también: la primera es la del producto más vendido), carrito siempre visible, total en vivo, pop-up de stock mínimo en cada venta, PRESENCIAL cobra al toque / A_RETIRAR queda pendiente.
  - `PedidosActivos.tsx` — acciones por estado (listo/cobrar/no retirado/reasignar/perdido/anular) con confirmación en destructivas.
  - `CobrarPedido.tsx` — pagos combinados, "Falta $X" / "Vuelto $X" en vivo, valida vuelto-sin-efectivo.
  - `OperacionesCaja.tsx` — gastos, retiros (selector cerrado de 3 socios), marcado de pollos, atenciones, costo cero.
- **`frontend/src/features/admin/`**: `Turnos.tsx` (historial, arqueos contado/esperado/diferencia/resultado, ventas por medio, unidades, gastos, retiros por socio, atenciones, marcados; desbloqueo remoto + generar clave — la clave se muestra UNA vez) y `StockMinimo.tsx` (config, toggle activa). `puedeEscribir = rol === 'ADMINISTRADOR'`; SOCIO solo lectura.
- **`ShellLocal.tsx`**: tabs Caja (default) / Recibir (módulo 1 INTACTO) / Stock (encargado). **Decisión**: el gate de turno aplica solo a Caja — recibir transferencias NO exige turno abierto.

## 2. INVARIANTES A AUDITAR (lo innegociable)

1. **Control ciego server-side**: las respuestas de `/turnos/abrir`, `/turnos/cerrar` y `/turnos/activo` para CAJERO/ENCARGADO jamás incluyen `valorEsperado`, `diferencia` ni `resultado` de ningún arqueo (ni siquiera "coincidió" — saberlo ya revela información). Whitelist en `turnos.serializers.ts`. El mensaje de bloqueo no revela cuál arqueo falló.
2. **Stock al confirmar, no al cobrar**. Anular EN_PREPARACION/LISTO repone TODO. ENTREGADO jamás se anula. Reasignar no descuenta de nuevo. Perdido no repone.
3. **Nunca stock negativo** — validación bloqueante en confirmar/modificar/atención/costo-cero/marcado.
4. **Pollo**: la venta (entero/medio, suelto o en combo) descuenta SOLO del producto MARCADO. Combos descuentan componentes, nunca el combo.
5. **Aislamiento de sucursal**: CAJERO/ENCARGADO operan solo en su `Usuario.sucursalId` (releída de DB, jamás confiada del JWT). ADMIN exento pero debe pasar `sucursalId` explícita.
6. **RBAC** según matriz de `CLAUDE-MODULO-2.md` §7. PRODUCCION: cero acceso al módulo 2. SOCIO: solo `GET /turnos` y `GET /turnos/:id/resumen`.
7. **Precios congelados**: `montoTotal` de línea inmutable post-confirmación; cambios de precio posteriores no alteran pedidos históricos.
8. **Auditoría inmutable** de todas las acciones §8 (anulación con snapshot COMPLETO).
9. **Dinero como Decimal** en DB; el cierre debe cuadrar al centavo: `esperado = apertura contada + efectivo neto de ventas − gastos efectivo − retiros efectivo`.
10. **Claves de emergencia**: nunca predecibles, un solo uso, expiran, nunca se re-muestran, todo auditado.

## 3. Cómo correr todo (esta máquina, sin Neon)

El `.env` local apunta a un Neon MUERTO. Todo se verifica con Postgres efímero local:

```bash
PGBIN="/c/Program Files/PostgreSQL/18/bin"
# cluster descartable (si no existe): initdb -D <dir>/pgdata -U postgres -A trust -E UTF8
"$PGBIN/pg_ctl" -D <dir>/pgdata -o "-p 5499" start
"$PGBIN/psql" -h localhost -p 5499 -U postgres -c "CREATE DATABASE polleria_test;"

# Tests (186 esperados):
export DATABASE_URL="postgresql://postgres@localhost:5499/polleria_test"
npx prisma migrate deploy && npx prisma generate
DATABASE_URL_TEST="$DATABASE_URL" npx vitest run

# Stack completo para e2e:
# DB e2e: crear polleria_e2e, migrate deploy, npx tsx prisma/seed.ts, cargar stock
# inicial en Local 1 (sucursalId=2) vía INSERT de MovimientoStock tipo AJUSTE
# (¡incluir "Pollo a la leña (entero) — MARCADO"!). SQL con ñ: usar archivo UTF-8.
DATABASE_URL="postgresql://postgres@localhost:5499/polleria_e2e" npm run dev   # backend :3000
cd frontend && npm run dev                                                     # :5173, proxy a :3000
# Usuarios seed: admin/admin123, cajero/cajero123, encargado/encargado123, ariel/socio123
```

Typecheck: `npx tsc --noEmit` (backend) · `cd frontend && npx tsc -b --noEmit`. Build: `cd frontend && npm run build`.

## 4. Qué se verificó YA (no repetir, buscar lo que falta)

- **186/186 tests** (33 unit + 153 integración) contra Postgres 18 local — incluyen: no-filtración de campos ciegos por inspección de JSON crudo, RBAC 403, aislamiento de sucursal, cierre que cuadra al centavo, transiciones inválidas, claves expiradas/reusadas, doble descuento en reasignación, stock mínimo con y sin cruce.
- **E2E en navegador (2026-07-20)**: apertura con conteo errado → BLOQUEADO (JSON de Network sin campos ciegos) → admin ve "SOBRANTE $500" → clave generada y usada → venta 1 pollo + 6 empanadas (tier $8.500 aplicado en carrito Y confirmado por backend; grilla reordenada por más vendidos tras la venta) → cobro MP $20.000 + efectivo $10.000, vuelto $500, efectivo persistido NETO $9.500 → gasto PAPAS $2.000 → retiro ARIEL $5.000 → marcado 4 pollos (DB: fresco 12→8, marcado 6+4−1=9) → cierre ciego 3.000/9 → COINCIDE, sin alerta, resumen solo-unidades, logout automático → admin ve resumen financiero completo.
- Typecheck y build de producción limpios en ambos proyectos.

## 5. Ideas de ataque para la auditoría (lo que NO probamos exhaustivamente)

- Carrera/concurrencia: dos cajeros abriendo turno a la vez en la misma sucursal; doble click en CONFIRMAR PEDIDO (¿pedido duplicado?); cobrar dos veces el mismo pedido en paralelo.
- Cobros raros: pago 100% electrónico con monto mayor al total (debe rechazar VUELTO_SIN_EFECTIVO); montos con más de 2 decimales; pedido de $0.
- Modificar pedido vía API directa (PATCH /pedidos/:id — sin UI, pero el endpoint existe): ¿respeta pagos ya registrados, estados, stock por diferencia?
- Clave de emergencia: ¿sirve para un turno de OTRA sucursal? ¿la puede usar un cajero ajeno al bloqueo?
- Cajero SIN `sucursalId` asignada: ¿qué pasa en /turnos/abrir y /pedidos?
- Serializers: ¿algún endpoint secundario (p. ej. GET /pedidos/:id, resumen adjunto en confirmar) filtra montos/esperados a roles que no deben verlos? ¿`GET /turnos/activo` para ENCARGADO?
- Ventana de expiración de clave exactamente a los 10:00 min; reloj del server vs. DB.
- Stock mínimo con ventas de combos (¿evalúa componentes?) y con atenciones.
- XSS/inyección en `aclaraciones`, `motivoDetalle`, `descripcion` (texto libre → se muestra en admin).
- Frontend: ¿algún estado del gate permite ver el POS con turno BLOQUEADO (p. ej. cache de react-query)? ¿El polling de 20 s puede pisar una pantalla de cierre en curso?

## 6. Pendientes conocidos (NO son hallazgos, ya están registrados)

Ver `CLAUDE-MODULO-2.md` §0 Fase 9 y §11: salas de Socket.io por sucursal (hoy polling), UI de modificar pedido, motivos de atención sin validar con cliente, retorno a producción sin `LineaIngreso` (pregunta abierta al cliente), timer de pedidos no retirados sin implementar, comandera mockeada (sin hardware), bebidas sin precio fijo, y todo `PRODUCCION-CHECKLIST.md` para el deploy.
