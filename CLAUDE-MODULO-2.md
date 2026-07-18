# CLAUDE-MODULO-2.md — Módulo 2: POS + Caja y Turnos

> **Este documento vive SOLO en la rama `feature/modulo-2`.** Es el CLAUDE.md específico del Módulo 2 — mismo rol que el CLAUDE.md raíz cumple para el Módulo 1: contexto autoritativo, se actualiza en cada fase, no se inventa lógica de negocio que lo contradiga. El CLAUDE.md raíz (`main`) sigue siendo la fuente de verdad del Módulo 1 y de las entidades transversales; este archivo lo complementa mientras el Módulo 2 esté en desarrollo. Cuando el módulo se mergee a `main`, su contenido relevante se vuelca al CLAUDE.md raíz y este archivo se puede retirar.

**Estado**: en desarrollo, rama `feature/modulo-2`, branch de Neon `modulo-2-dev` (aislada de la DB que usa el cliente para ver el Módulo 1 en `main`).

---

## 0. ORIGEN DE ESTE DOCUMENTO Y CORRECCIONES APLICADAS

El cliente entregó la especificación completa del Módulo 2 (secciones 1 a 12 más abajo, preservadas tal cual las escribió) el 2026-07-17, ya validada con Ariel/Eliana/Pablo. Al cruzarla contra el `schema.prisma` real del Módulo 1 aparecieron discrepancias entre el borrador y las convenciones ya establecidas. **Se corrigieron antes de escribir la migración** (no se tocó nada del contenido de negocio, solo la representación en datos):

1. **IDs**: el borrador usaba `String @id @default(cuid())` en todos los modelos nuevos. El schema real usa `Int @id @default(autoincrement())` en absolutamente todas las tablas existentes. Se mantiene `Int autoincrement` en todo lo nuevo del Módulo 2, por consistencia.
2. **No existe un modelo `Combo`**: los combos son `Producto` con `tipo: COMBO` + `ComboComponente` (implementado en el Módulo 1, ver CLAUDE.md raíz §9). El borrador tenía `comboId` en `ItemDePedido` y `Atencion` además de `productoId` — **se eliminó `comboId` en ambos**. Un combo se vende como cualquier `Producto` (`productoId` apunta al combo); al confirmar, el backend recorre `ComboComponente` de ese producto para generar el `MovimientoStock` de cada componente.
3. **`TipoMovimientoStock` ya tenía reservados** (agregados en el Módulo 1 pensando en este momento): `VENTA`, `ANULACION_REPOSICION`, `ATENCION`, `MERMA_QUEMADO`, `RETORNO_A_PRODUCCION`, `MARCADO_POLLO`, `AJUSTE`. No se agregó nada a ese enum.
4. **`TipoAlerta` ya tenía reservados** `DISCREPANCIA_CAJA`, `BLOQUEO_TURNO`, `STOCK_MINIMO` — se reutilizan tal cual.
5. **Se agregó el enum `MedioPago`** (no existía): `EFECTIVO`, `DEBITO`, `CREDITO`, `MERCADO_PAGO`, `TRANSFERENCIA`.
6. **Modelado del "pollo marcado" — decisión de diseño mía, NO validada explícitamente con el cliente**: el borrador tiene `EventoMarcadoPollo` como bitácora pero no especifica cómo se lleva el conteo de "cuántos pollos marcados hay ahora". Para no inventar un mecanismo de stock paralelo al ya existente, se modela igual que todo lo demás en el sistema: **"Pollo a la leña (entero) — MARCADO" es un `Producto` nuevo** (mismo patrón que ya existe entre "Pollo a la leña (entero)" y "Pollo a la leña (medio)"), con stock = SUM(MovimientoStock) igual que cualquier producto, sin precio propio (nunca se vende directamente). `EventoMarcadoPollo` dispara, en la misma transacción: un `MovimientoStock` `MARCADO_POLLO` negativo sobre "Pollo a la leña (entero)" (fresco) y uno positivo sobre "Pollo a la leña (entero) — MARCADO". Vender un "medio" descuenta 0.5 del marcado (el campo ya es `Decimal(12,3)`, soporta fracciones igual que los insumos de las fichas técnicas). **Repreguntar al cliente** si este modelo coincide con cómo manejan físicamente el pollo partido a mitad (¿la otra mitad queda disponible para otro cliente, o se descarta/retorna?).
7. **Precisión numérica**: se sigue la convención ya establecida — montos de dinero `Decimal @db.Decimal(12, 2)` (igual que `Precio.monto`), cantidades/stock `Decimal @db.Decimal(12, 3)` (igual que `MovimientoStock.cantidad`). `Arqueo.valorContado/valorEsperado/diferencia` usa `Decimal(12,3)` genérico para ambos tipos (efectivo y pollos); el formato de display es responsabilidad del frontend.
8. El resto del borrador (enums de estado, la lógica de negocio completa de las secciones 4–9 de abajo) se preserva tal cual — está bien pensado y es consistente con las reglas ya validadas del Módulo 1.

**Progreso de implementación** (se actualiza en cada fase, ver plan en `C:\Users\brusc\.claude\plans\recursive-sniffing-quail.md` del lado de quien lo desarrolla, o pedir el resumen):
- ✅ Fase 0: rama `feature/modulo-2` creada. Branch de Neon `modulo-2-dev` creada (copia de `production` con datos + schema al 2026-07-17), `.env` local apuntando a ella (la URL de `production` queda comentada arriba en el mismo archivo para volver fácil al Módulo 1).
- ✅ Fase 1: schema completo escrito, validado y migrado contra `modulo-2-dev` (migración `20260717195901_modulo_2_turnos_pedidos_caja`). Seed corrido: 81 productos (incluye "Pollo a la leña (entero) — MARCADO"), 7 usuarios. Las 13 tablas nuevas verificadas y accesibles. La base de tests (`polleria_test` de la branch nueva) también migrada; `DATABASE_URL_TEST` del `.env` apunta a ella.
- ✅ Fase 2: **Turnos + arqueo doble ciego + bloqueo/desbloqueo (backend)** — `src/modules/turnos/` (calculos puros, service, serializers ciegos, claves de emergencia, routes registradas en `app.ts` como `/api/turnos` y `/api/claves-emergencia`). Decisiones tomadas: (a) la referencia ciega de la apertura es lo **contado** en el cierre del último turno CERRADO de la sucursal (0 si nunca hubo — primer arranque); (b) los pollos esperados al cierre = apertura contada + neto de `MovimientoStock` del producto MARCADO durante el turno (una sola fuente de verdad, no se recuentan eventos); (c) la discrepancia en el CIERRE no bloquea (alerta `DISCREPANCIA_CAJA` al admin, el turno cierra igual) — el bloqueo es solo en apertura, como pide §5.1; (d) el mensaje de bloqueo al cajero no revela ni cuál de los DOS arqueos falló; (e) claves de emergencia: 8 caracteres sin ambiguos (se dictan por teléfono), generar una nueva invalida la anterior, cualquier fallo al usarla responde el mismo error genérico `CLAVE_INVALIDA`; (f) ADMIN debe indicar `sucursalId` explícita para abrir/cerrar (no tiene sucursal fija); CAJERO/ENCARGADO usan la propia releída de DB. Tests: 14 unitarios (`turnos.calculos.test.ts`) + 20 de integración (`turnos.test.ts`, incluye no-filtración de campos ciegos por inspección del JSON crudo, RBAC y aislamiento de sucursal).
- ✅ Fase 3: **Pedidos — núcleo del POS (backend)** — `src/modules/pedidos/` (calculos puros, service, comandera mock, routes en `/api/pedidos`). Decisiones tomadas: (a) el pedido **nace confirmado** (`POST /pedidos` = confirmar): el carrito vive en el frontend, el registro en DB descuenta stock, congela precios y emite ticket, todo atómico; (b) **`ItemDePedido.montoTotal`** (migración `item_pedido_monto_total`): con la tabla de precio por volumen el total de N unidades no es N × unitario, así que se congela el TOTAL de la línea como fuente de verdad y `precioUnitario` queda como referencia (total/cantidad redondeado); (c) precio por volumen: tier exacto si existe, si no descomposición greedy de mayor a menor (13 empanadas = 12 + 1) — con la estructura real de precios del cliente es también la combinación más barata; (d) el pollo (entero o medio, suelto o dentro de un combo) descuenta del producto MARCADO (medio = 0,5), nunca del fresco; los combos descuentan cada componente; (e) el vuelto sale SOLO del efectivo y el `Pago` EFECTIVO se registra NETO de vuelto (lo que queda físicamente en la caja — así el arqueo de cierre cuadra); (f) PRESENCIAL puede cobrarse directo desde EN_PREPARACION (paga al momento) — el diagrama §4.4 se respeta en todo lo demás, ENTREGADO jamás se anula; (g) la referencia ciega de pollos en el PRIMER turno de una sucursal es el stock actual del producto MARCADO (0 en instalación fresca) — evita un bloqueo espurio si el sistema arranca con pollos ya en la parrilla; (h) reasignación: pedido nuevo LISTO con los precios congelados del original, sin tocar stock; perdido: líneas marcadas costo cero DESPERDICIO_QUEMADO, sin reposición. Tests: 27 unitarios (`pedidos.calculos.test.ts`) + 17 integración (`pedidos.test.ts`, incluye el cierre de turno cuadrando al centavo contra las ventas del turno).
- ⬜ Fases 4–9: pendientes. Pendiente puntual de Fase 2 para la Fase 6: sala de Socket.io por sucursal para que `turno:desbloqueado` llegue al POS del cajero (hoy solo se emite a la sala de admins).

---

## 1. PRINCIPIO DE DISEÑO RECTOR — EL CONTROL CIEGO (INNEGOCIABLE)

Ya implementado en módulo 1, se extiende al módulo 2:

> **El empleado que carga un conteo NUNCA ve el valor esperado antes de cargar. El sistema compara internamente y solo informa las discrepancias al Administrador.**

En el módulo 2 aplica a:
- **Arqueo de apertura de caja**: el cajero cuenta el efectivo físico sin saber cuánto debería haber.
- **Arqueo de pollos marcados en apertura**: mismo principio, para el conteo de pollos disponibles.
- **Arqueo de cierre de caja**: ídem apertura.
- **Arqueo de pollos marcados en cierre**: ídem.

El backend NUNCA devuelve el monto esperado al frontend antes de que el cajero cargue su conteo. La API solo responde "coincide / no coincide" — el monto esperado, el faltante y el sobrante los ve solo el ADMINISTRADOR.

---

## 2. ROLES (sin cambios del módulo 1)

| Rol | Qué puede hacer en el módulo 2 |
|---|---|
| **ADMINISTRADOR** | Todo. Recibe todas las alertas. Puede desbloquear turnos bloqueados. Genera claves de emergencia. Ve resúmenes financieros completos de todos los turnos. |
| **SOCIO** | Solo lectura: ve reportes de ventas, cierres de caja, retiros. NO puede abrir turnos, cobrar, ni hacer nada operativo. |
| **ENCARGADO** | Puede desbloquear un turno bloqueado si el admin se lo autoriza. Opera el POS igual que el CAJERO. Puede ver el stock de su local. |
| **CAJERO** | Opera el POS: abre turno, carga pedidos, cobra, registra gastos y retiros, cierra turno. **No ve diferencias de caja ni montos esperados.** |
| **PRODUCCION** | Sin acceso a ningún endpoint del módulo 2. |

**Regla de sucursal**: un CAJERO o ENCARGADO solo puede abrir turno, vender y operar en la sucursal asignada en `Usuario.sucursalId`. El backend valida esto siempre contra la DB.

---

## 3. ENTIDADES — YA IMPLEMENTADAS EN EL SCHEMA (con las correcciones de §0)

`Turno`, `Arqueo`, `BloqueoDeTurno`, `ClaveDeEmergencia`, `Pedido`, `ItemDePedido`, `Pago`, `Atencion`, `GastoDeCaja`, `RetiroDeCaja`, `EventoMarcadoPollo`, `TicketCocina`, `ConfiguracionStockMinimo` — ver `prisma/schema.prisma`, sección "MÓDULO 2 — POS + CAJA Y TURNOS". Enums: `EstadoTurno`, `MomentoArqueo`, `TipoArqueo`, `ResultadoArqueo`, `EstadoBloqueo`, `TipoDesbloqueo`, `TipoPedido`, `EstadoPedido`, `MedioPago`, `TipoCostoCero`, `SocioRetiro`, `TipoTicket`.

Producto nuevo en el seed: **"Pollo a la leña (entero) — MARCADO"** (ver corrección #6 de §0).

---

## 4. FLUJO 4 — VENTA EN EL POS

### 4.1 Pantalla del POS — reglas de UX críticas (INNEGOCIABLE)

- Interfaz táctil con **botones grandes** agrupados por categoría.
- Los productos se ordenan por **más vendidos primero** — el sistema calcula esto automáticamente desde el historial de `ItemDePedido` por sucursal. No es un orden manual. Si un producto nunca se vendió, va al final. Pedido explícito del cliente: "que lo que más se pide aparezca primero para no perder tiempo".
- El total del pedido se actualiza en tiempo real a cada cambio.
- El carrito del pedido está siempre visible junto a los productos.

### 4.2 Tipos de pedido

Al iniciar un pedido el cajero elige:
- **PRESENCIAL**: el cliente está en el local. Se cobra en el momento.
- **A_RETIRAR**: pedido por teléfono o WhatsApp (futuro). El cajero lo carga, queda en lista de pendientes. Se cobra cuando el cliente llega.

### 4.3 Variantes y precios

- **Pollos**: se venden por porción → `entero` o `medio`. Son productos distintos en el catálogo (no variantes de uno). Al tocar "Pollo" en el POS debe aparecer el selector entero/medio.
- **Combos**: precio propio, no calculado. Ya modelado en módulo 1 con `Producto.tipo=COMBO` y `ComboComponente`. Al vender un combo, los `MovimientoStock` se generan por cada componente.
- **Empanadas**: precio por volumen con tabla de precios (`Precio.cantidad`). Ej: 1 = $X, 6 = $Y, 12 = $Z. El POS debe calcular el precio óptimo según la cantidad pedida.
- El precio que se usa es siempre el vigente en la fecha del pedido. Se congela en `ItemDePedido.precioUnitario` al confirmar.

### 4.4 Ciclo de vida de un pedido — estados (INNEGOCIABLE)

```
Cargando items (no registrado aún)
        ↓ [cajero confirma]
  EN_PREPARACION  ←→  (modificaciones y anulación posibles)
        ↓ [cajero marca como listo]
      LISTO
      /    \
[cobrado]   [no viene a buscarlo]
    ↓              ↓
ENTREGADO    LISTO_NO_RETIRADO
                  /    \
         [se vende a   [se descarta]
          otro cliente]      ↓
               ↓          PERDIDO → (venta a costo cero, tipo DESPERDICIO_QUEMADO)
          REASIGNADO

En cualquier estado antes de ENTREGADO/PERDIDO:
        ↓ [cajero anula]
      ANULADO
```

### 4.5 Descuento de stock — cuándo (INNEGOCIABLE)

**El stock se descuenta al CONFIRMAR el pedido (pasar a EN_PREPARACION), NO al cobrar.**

Validado con Ariel textualmente: *"Si se mandó a preparar, se consumió, se retire o no."* Si el cliente no viene, el stock ya se consumió — el pedido pasa a LISTO_NO_RETIRADO y desde ahí o se reasigna (el stock ya estaba descontado, el nuevo pedido no descuenta de nuevo) o se marca como PERDIDO (venta a costo cero, el stock no se repone porque ya se usó).

**Excepción: ANULADO**. Si se anula un pedido EN_PREPARACION (se manda a no prepararlo), el stock SÍ se repone (`MovimientoStock` `ANULACION_REPOSICION`).

### 4.6 Modificaciones y anulaciones post-confirmación

- Un pedido confirmado (EN_PREPARACION o LISTO) puede modificarse o anularse.
- **Modificación**: ajusta el stock (descuenta o repone la diferencia), manda ticket de actualización a cocina, registra en auditoría qué cambió, quién y cuándo.
- **Anulación**: repone TODO el stock del pedido, manda ticket de anulación a cocina, guarda el pedido COMPLETO tal como estaba en `RegistroAuditoria` (no solo "fue anulado" — los items completos quedan en el registro).
- Un pedido ENTREGADO NO puede anularse. Solo el ADMINISTRADOR puede hacer ajustes posteriores.

### 4.7 Cobro

- Se puede cobrar con **combinación de medios** en un mismo pedido (ej: parte efectivo, parte MP).
- Si hay pago en efectivo, el sistema calcula el vuelto automáticamente.
- El pedido pasa a ENTREGADO cuando se registra el pago.
- Medios: `EFECTIVO`, `DEBITO`, `CREDITO`, `MERCADO_PAGO`, `TRANSFERENCIA`.

### 4.8 Atenciones / Regalías

- Producto o combo sin cargo.
- Antes de confirmar el cobro, el cajero puede registrar una atención.
- Datos obligatorios: producto/combo, cantidad, motivo (de lista predefinida + opción "OTRO" con texto libre).
- El stock se descuenta igual que una venta normal (`MovimientoStock` `ATENCION`).
- No genera pago (costo cero para el cliente).
- Queda registrada en el historial del turno como egreso de stock.
- Cualquier usuario logueado puede registrarla (no requiere rol especial), pero queda con el nombre del que está en sesión.

### 4.9 Venta a costo cero (mermas y retornos) — INNEGOCIABLE

Mecanismo para registrar productos que no se cobran pero consumen stock. Se opera desde la misma pantalla del POS (no es un módulo aparte).

Dos tipos:

**DESPERDICIO_QUEMADO**: producto destruido, no aprovechable.
- Stock muere ahí (`MovimientoStock` `MERMA_QUEMADO`).
- No mueve la caja.
- Agrupa para el reporte: *"esta semana se quemaron X pollos, Y milanesas, Z empanadas"*
- Aplica a pollos quemados en la parrilla, milanesas sobrecocidas, empanadas quemadas, etc.

**RETORNO_A_PRODUCCION**: producto que no se vendió pero es aprovechable.
- Descuenta del stock del local (`MovimientoStock` `RETORNO_A_PRODUCCION` negativo en el local).
- Suma al stock de la sucursal Producción como insumo (`MovimientoStock` `RETORNO_A_PRODUCCION` positivo en Producción).
- Ejemplo: pollo cocido no vendido → vuelve a producción como insumo para empanadas de pollo.
- No mueve la caja.

### 4.10 Circuito especial del pollo (INNEGOCIABLE)

El pollo tiene un stock intermedio que los demás productos no tienen.

**3 estados del stock de pollo** (ver corrección #6 de §0 para el modelado en datos):
1. **Pollo fresco/preparado** (en freezer, unidades): llega vía transferencia desde producción. Es "Pollo a la leña (entero)", `Producto` normal con su stock.
2. **Pollo marcado** (en la parrilla, cocinándose): "tiran" los pollos a la parrilla al inicio del turno o en el transcurso. Registro por `EventoMarcadoPollo`. Descuenta del stock de pollo fresco y suma al `Producto` "Pollo a la leña (entero) — MARCADO".
3. **Pollo vendido**: la venta descuenta de los **marcados**, no del fresco.

**Reglas:**
- La venta de pollo (entero o medio) descuenta del stock de pollos **marcados**, no del fresco.
- Si no hay pollos marcados, no se puede vender pollo (alerta + bloqueo cuando llega a cero).
- En el arqueo de apertura/cierre, el cajero cuenta los pollos marcados que hay físicamente (sin saber cuántos dice el sistema que debería haber — control ciego).
- Los pollos marcados que sobran al cierre del turno pasan como saldo al turno siguiente.

**Destinos del pollo marcado no vendido al final del turno:**
- **Sigue disponible (apto)**: queda en el conteo de marcados, pasa al turno siguiente.
- **Reutilizable** (cocido pero no como pollo entero): el cajero lo registra como `RETORNO_A_PRODUCCION` — vuelve a producción como insumo para empanadas de pollo.
- **Quemado/inaprovechable**: el cajero lo registra como `DESPERDICIO_QUEMADO` — sale del sistema.

### 4.11 Comandera (impresora térmica)

- Al confirmar un pedido → se envía el ticket a la impresora de cocina vía ESC/POS.
- El backend envía el job de impresión directamente a la IP de la impresora en la red local del local.
- Librería: `node-escpos` o similar.
- Si la impresora no responde: **el pedido se confirma igual** (no bloquear la operación por fallo de impresora), se registra el error en `TicketCocina.errorImpresion`, y se muestra alerta visual en el POS para que el cajero informe verbalmente a cocina.
- También se envía ticket al modificar un pedido (tipo `ACTUALIZACION`) y al anularlo (tipo `ANULACION`).
- **Por ahora se implementa la lógica pero sin hardware real** — mock de impresión que loguea en consola y simula la respuesta. El cliente aún no compró las impresoras (Epson TM-T20 o similar, ~$80-150 USD). La arquitectura debe permitir enchufar el hardware real con un cambio mínimo.

---

## 5. FLUJO 5 — CAJA Y TURNOS

### 5.1 Apertura de turno

**Paso 1 — Login**
El cajero entra con su usuario. Si no hay turno abierto para su sucursal, el sistema le exige apertura antes de poder vender. No puede hacer nada (ni ver el POS) hasta abrir el turno.

**Paso 2 — Arqueo doble y ciego de apertura**
El cajero hace DOS conteos sin ver ningún número de referencia:
1. **Cuenta el efectivo físico** en la caja e ingresa el monto.
2. **Cuenta los pollos marcados** disponibles físicamente e ingresa la cantidad.

La pantalla de arqueo es neutral: solo muestra los campos para ingresar los valores. Sin saldos anteriores, sin sugerencias, sin totales del turno anterior visibles.

**Paso 3 — El sistema compara internamente**
El sistema calcula:
- `saldoEsperadoEfectivo` = saldo final de efectivo del turno anterior (o 0 si es el primer turno del día)
- `pollosMarcadosEsperados` = conteo final de pollos marcados del turno anterior (o 0)

Si ambos coinciden → **turno ABIERTO**, el cajero puede vender.
Si alguno no coincide → **turno BLOQUEADO**.

**CRÍTICO — qué ve el cajero cuando hay discrepancia**:
- Mensaje genérico: *"Hay una diferencia en el conteo. Se notificó al administrador. Esperá la autorización para continuar."*
- **NO se muestra**: cuánto hay de diferencia, qué esperaba el sistema, si es faltante o sobrante, en qué lado está el error.
- El cajero no puede hacer nada hasta que lo desbloqueen.

**Qué ve el ADMINISTRADOR cuando hay discrepancia**:
- Monto esperado, monto contado, diferencia (faltante/sobrante), en efectivo y/o pollos marcados.
- **Nombre del cajero que cerró el turno anterior** (para preguntarle a él primero).
- Nombre del cajero que está intentando abrir.
- Botón para desbloquear el turno.

**Paso 4 — Desbloqueo (dos caminos)**

**Camino A — Remoto (el admin tiene acceso)**:
El ADMINISTRADOR ve la alerta en su panel, revisa los datos y aprieta "Desbloquear". El turno pasa a ABIERTO. Se registra: quién autorizó, cuándo, con qué diferencia había, cajero anterior y cajero actual.

**Camino B — Clave de emergencia (el admin no tiene acceso en ese momento)**:
- En la pantalla de bloqueo hay una opción discreta (no obvia, pequeña, en un rincón) que abre un campo para ingresar la clave.
- El admin genera la clave desde su panel (botón "Generar clave de emergencia para Local X"). La clave es aleatoria, de un solo uso, expira a los 10 minutos.
- El admin se la dicta al cajero por teléfono.
- El cajero la ingresa y el turno se desbloquea.
- El evento queda registrado igual que en el Camino A: quién autorizó, código usado, cajero anterior y actual, diferencia que había, hora exacta.
- **La clave nunca se muestra dos veces**: después de generarla, el admin la ve una vez. Si la pierde, genera otra (la anterior queda invalidada).

### 5.2 Gestión del turno

Mientras el turno está ABIERTO, el cajero puede:

**Vender** (Flujo 4 — ya descripto)

**Registrar gastos de caja**:
- Monto, medio de pago (solo EFECTIVO o MERCADO_PAGO para gastos), categoría de lista predefinida u "OTRO" con descripción libre.
- Categorías sugeridas: PAPAS, LEÑA/CARBON, LIMPIEZA, BEBIDAS, VERDULERIA, CONDIMENTOS, OTRO.
- Queda registrado con el usuario cajero y la hora.

**Registrar retiros de caja**:
- Monto, medio de pago.
- **Quién de los socios retiró**: selector CERRADO con las 3 opciones → `ARIEL`, `ELIANA`, `EMA`. No es texto libre. No hay cuarta opción.
- El cajero registra el retiro pero no acumula ni ve el total retirado.

**Registrar marcado de pollos** (EventoMarcadoPollo):
- "Tiré X pollos a la parrilla": el cajero indica cuántos puso a cocinar.
- Descuenta X del stock de pollo fresco del local, suma X al conteo interno de pollos marcados.
- Se puede hacer múltiples veces en el turno (si a mitad del turno meten más pollos).

### 5.3 Cierre de turno

**Paso 1 — El cajero selecciona "Cerrar turno"**
El sistema le pide que haga el arqueo de cierre.

**Paso 2 — Arqueo doble y ciego de cierre**
Igual que en la apertura: el cajero cuenta el efectivo e ingresa el monto, cuenta los pollos marcados e ingresa la cantidad. Sin ver ningún número de referencia.

**Paso 3 — El sistema cruza todo**
El sistema calcula internamente:
```
Saldo final esperado efectivo =
  saldo apertura
  + ventas cobradas en EFECTIVO
  - gastos pagados en EFECTIVO
  - retiros en EFECTIVO
  - atenciones (costo cero, no mueven caja)

Saldo pollos marcados esperado =
  pollos marcados apertura
  + eventos de marcado durante el turno
  - pollos vendidos (entero o medio)
  - pollos retornados a producción
  - pollos desperdiciados/quemados
```

**Paso 4 — Lo que ve cada rol al cierre**

**El cajero VE**:
- Resumen de ventas **por unidad, sin montos de dinero**: cuántos pollos enteros, cuántos medios, cuántas milanesas, etc.
- Conteo final de pollos marcados que quedan (para que sepa qué tiene disponible).
- Mensaje de confirmación de cierre.

**El cajero NO VE**:
- El total vendido en pesos.
- La diferencia de caja (si la hay).
- El faltante o sobrante.
- Los montos de retiros ni de gastos.
- Nada financiero.

**El ADMINISTRADOR y los SOCIOS VEN** (en sus reportes):
- Resumen financiero completo: ventas por medio de pago, gastos, retiros por socio, atenciones, mermas.
- Diferencia de caja (faltante/sobrante) con el detalle del arqueo.
- Discrepancia en pollos marcados si la hubo.

**Paso 5 — El turno queda CERRADO**
Los saldos finales (efectivo y pollos marcados) quedan registrados como referencia para el arqueo de apertura del turno siguiente. La sesión del cajero se cierra automáticamente.

---

## 6. LÓGICA DE NEGOCIO CRÍTICA — RESUMEN

### 6.1 Stock y transacciones atómicas

Todo movimiento de stock sigue el patrón ya establecido en el módulo 1:
- Cada movimiento genera un `MovimientoStock`.
- El stock actual = `SUM(MovimientoStock.cantidad)` por producto+sucursal.
- Toda operación multi-tabla va en `$transaction` de Prisma.
- Si la transacción falla, NADA se modifica.

Tipos de `MovimientoStock` que usa este módulo (ya existentes en el enum, ver §0.3): `VENTA`, `ANULACION_REPOSICION`, `ATENCION`, `MERMA_QUEMADO`, `RETORNO_A_PRODUCCION`, `MARCADO_POLLO`.

### 6.2 Precio vigente — congelado al confirmar

El precio de cada ítem se congela en `ItemDePedido.precioUnitario` al confirmar el pedido. Si el precio del producto cambia después, el pedido histórico no se altera. Se usa el precio vigente en el momento de confirmar, considerando `Precio.cantidad` para empanadas y otros productos con tabla de precios por volumen.

### 6.3 Combos — impacto en stock

Al vender un combo (`productoId` apunta al `Producto` tipo `COMBO`), el stock se descuenta por cada componente (`ComboComponente`) del combo, no por el combo en sí (los combos no tienen stock propio).

### 6.4 Pollos marcados — conteo ciego en apertura/cierre (INNEGOCIABLE)

El arqueo de pollos marcados funciona exactamente igual que el arqueo de efectivo:
- El cajero cuenta físicamente cuántos pollos marcados hay.
- El sistema compara con los que debería haber.
- La discrepancia va al ADMINISTRADOR, no al cajero.
- Si no coincide en la apertura → turno BLOQUEADO (mismo mecanismo que el efectivo).

### 6.5 Pedidos no retirados — circuito completo

Un pedido `A_RETIRAR` que nadie viene a buscar:
1. El cajero lo marca como `LISTO_NO_RETIRADO`.
2. Opciones disponibles:
   - **Reasignar**: otro cliente pide lo mismo. El pedido original pasa a `REASIGNADO` y queda vinculado al nuevo pedido. El stock NO se descuenta de nuevo (ya se descontó al confirmar el original). El nuevo pedido solo registra el cobro.
   - **Marcar como perdido**: pasa a `PERDIDO`. Se registra automáticamente como venta a costo cero tipo `DESPERDICIO_QUEMADO` (el producto se tiró — ya estaba descontado del stock, no hay reposición).

### 6.6 Alertas de stock mínimo desde el POS

- `ConfiguracionStockMinimo` define umbrales por producto y sucursal.
- Cada venta que baja el stock → si queda bajo el mínimo → pop-up en el POS. Se repite en CADA venta siguiente mientras siga bajo el mínimo. No bloquea.
- Si el stock llega a **cero**: bloqueo real. No se puede vender ese producto. El POS no lo muestra como disponible o lo muestra bloqueado claramente.
- Notificación al ADMINISTRADOR cuando se cruza el mínimo.

---

## 7. RBAC — ENDPOINTS DEL MÓDULO 2

| Endpoint | ADMIN | SOCIO | ENCARGADO | CAJERO | PRODUCCION |
|---|---|---|---|---|---|
| `POST /turnos/abrir` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /turnos/cerrar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /turnos/activo` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /turnos/:id/desbloquear` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /claves-emergencia` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /claves-emergencia/usar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `PATCH /pedidos/:id` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/cobrar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/anular` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/marcar-listo` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/no-retirado` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/reasignar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/marcar-perdido` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /pedidos/pendientes` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /atenciones` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /gastos-caja` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /retiros-caja` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /marcado-pollos` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /turnos` (historial) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /turnos/:id/resumen` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /config-stock-minimo` | ✅ | ❌ | ❌ | ❌ | ❌ |

**Regla de sucursal en todos los endpoints operativos**: el backend valida siempre contra `Usuario.sucursalId` en la DB. Un CAJERO del Local 1 no puede abrir turno ni crear pedidos en el Local 2. Error 403 si intenta.

---

## 8. AUDITORÍA — ACCIONES A REGISTRAR

Extender el sistema de auditoría existente con:

- `ABRIR_TURNO`
- `CERRAR_TURNO`
- `BLOQUEO_TURNO` (con cajero anterior + cajero actual + diferencias)
- `DESBLOQUEO_TURNO_REMOTO` (con quién autorizó + diferencias)
- `DESBLOQUEO_TURNO_CLAVE` (con quién generó la clave + diferencias)
- `GENERAR_CLAVE_EMERGENCIA`
- `CONFIRMAR_PEDIDO` (con snapshot completo del pedido)
- `MODIFICAR_PEDIDO` (con estado anterior + estado nuevo)
- `ANULAR_PEDIDO` (con snapshot COMPLETO del pedido tal como estaba — no solo "fue anulado")
- `COBRAR_PEDIDO`
- `REGISTRAR_ATENCION`
- `REGISTRAR_GASTO_CAJA`
- `REGISTRAR_RETIRO_CAJA` (con qué socio retiró)
- `MARCAR_POLLOS`
- `VENTA_COSTO_CERO`

Para `ANULAR_PEDIDO`: el campo `datosAnteriores` debe contener el pedido COMPLETO con todos sus ítems y precios. Regla de negocio explícita validada con el cliente.

---

## 9. WEBSOCKETS — USO EN MÓDULO 2

El módulo 1 ya tiene Socket.io configurado para alertas en tiempo real. Extender con:

| Evento | Quién emite | Quién escucha | Cuándo |
|---|---|---|---|
| `alerta:stock_minimo` | Backend | POS del local + Admin | Cuando el stock cruza el mínimo |
| `ticket:nuevo` | Backend | Cocina (impresora) | Al confirmar un pedido |
| `ticket:actualizacion` | Backend | Cocina | Al modificar un pedido |
| `ticket:anulacion` | Backend | Cocina | Al anular un pedido |
| `turno:bloqueado` | Backend | Admin | Al detectar discrepancia en apertura |
| `turno:desbloqueado` | Backend | POS del cajero | Admin desbloquea turno |
| `pedido:listo_no_retirado` | Backend (timer) | Admin | Pedido pendiente hace N minutos (configurable) |

---

## 10. TESTING OBLIGATORIO

### 10.1 Tests unitarios (lógica pura)

- Cálculo de saldo esperado de efectivo al cierre
- Cálculo de pollos marcados esperados al cierre
- Cálculo de diferencia de arqueo (faltante/sobrante)
- Precio correcto con tabla de volumen (empanadas)
- Vuelto automático en pago mixto
- Expiración de clave de emergencia (genera código → usa antes de 10 min → ok; genera → espera → rechaza)
- Invalidación de clave ya usada
- Ciclo de estados del pedido (transiciones válidas e inválidas)

### 10.2 Tests de integración

- Flujo completo de turno: apertura → venta → cobro → gasto → retiro → cierre. Verificar que el saldo cuadra.
- Apertura con discrepancia en efectivo → bloqueo → desbloqueo remoto → venta posible.
- Apertura con discrepancia en pollos → bloqueo → desbloqueo por clave de emergencia → venta posible.
- Anulación de pedido → reposición de stock → registro completo en auditoría.
- Pedido no retirado → reasignación → el stock no se descuenta dos veces.
- Pedido no retirado → marcar perdido → venta a costo cero generada.
- Combo vendido → stock de cada componente descontado.
- Pollos: marcado → venta de pollos marcados → cierre con discrepancia.
- RBAC: PRODUCCION no puede abrir turno (403). SOCIO no puede crear pedidos (403). CAJERO no puede desbloquear turno (403).
- **Aislamiento de sucursal**: CAJERO del Local 1 no puede operar en Local 2 (403).
- **Control ciego de caja**: el JSON de respuesta de apertura y cierre NUNCA incluye `valorEsperado` ni `diferencia` para roles CAJERO o ENCARGADO.
- Stock mínimo: venta que lleva a cero → bloqueo real; venta que baja del mínimo → alerta sin bloqueo.
- Inmutabilidad de auditoría: no hay endpoint de UPDATE/DELETE en `/auditoria`.

---

## 11. PENDIENTES CONOCIDOS (no bloquean el módulo 2)

- Heredados del Módulo 1: receta real de la empanada de pollo, peso real de una milanesa individual, cookie de refresh `sameSite: strict`, fotos de remito en disco local, persona concreta para el rol ENCARGADO, plan de costeo Fases B/C.
- **Nuevo — modelado del pollo marcado (corrección #6 de §0)**: no validado con el cliente, repreguntar sobre el destino de la "otra mitad" cuando se vende un medio.
- Bebidas: sin precio fijo en el negocio, definir si tienen precio variable o si se cargan manualmente por turno.
- Hardware de impresoras: el cliente no las compró todavía. La comandera se mockea en consola y la arquitectura permite enchufar el hardware real después.
- Timer de pedidos no retirados: cuántos minutos deben pasar para que el sistema alerte al admin. Valor default sugerido: 30 minutos. Confirmar con cliente.

---

## 12. CRITERIO DE "MÓDULO 2 TERMINADO"

El backend y frontend del módulo 2 están terminados cuando:

1. Un CAJERO puede abrir su turno con arqueo doble ciego (efectivo + pollos) y el sistema bloquea si hay discrepancia.
2. El ADMINISTRADOR puede desbloquear el turno (remoto o clave de emergencia) y el evento queda auditado con ambos cajeros.
3. El CAJERO puede cargar, confirmar, cobrar y anular pedidos desde el POS táctil.
4. El stock se descuenta al confirmar (no al cobrar) y se repone solo en anulaciones de pedidos EN_PREPARACION.
5. Los pedidos no retirados pueden reasignarse o marcarse como perdidos sin descuento doble de stock.
6. Las ventas a costo cero (mermas y retornos a producción) funcionan y agrupan para reportes.
7. El circuito del pollo marcado funciona: fresco → marcado → vendido/retornado/quemado.
8. El cajero cierra el turno con arqueo doble ciego y NO ve ningún dato financiero en su resumen.
9. El ADMINISTRADOR y los SOCIOS ven el resumen financiero completo en sus reportes.
10. La comandera mockea correctamente (loguea en consola) y la arquitectura permite enchufar hardware real.
11. Todos los tests pasan, incluidos los de control ciego de caja y RBAC del módulo 2.
12. El CLAUDE.md se actualiza con las decisiones tomadas durante el desarrollo y los pendientes resueltos.
