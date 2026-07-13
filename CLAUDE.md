# CLAUDE.md — Sistema de Gestión para Pollería

> **Propósito de este archivo**: contexto completo y autoritativo del proyecto para Claude Code. Todo lo que está acá fue definido y validado con los clientes (Ariel, Eliana/Pablo — dueños del negocio) a lo largo de múltiples reuniones de relevamiento. **No inventar lógica de negocio que contradiga este documento.** Si algo no está definido acá, está marcado explícitamente como "pendiente de definir" — preguntar antes de asumir.

---

## 1. CONTEXTO DEL NEGOCIO

### 1.1 Qué es el negocio

Pollería gastronómica en Córdoba, Argentina. Vende pollos, milanesas, lomitos, empanadas, hamburguesas, papas fritas y productos relacionados. Opera en **tres ubicaciones físicas**:

1. **Producción (central)**: llega la materia prima en bruto (por kilo), se transforma en unidades listas para cocinar (milanesas, bifes, porciones).
2. **Local de venta 1**: recibe unidades ya producidas, cocina a pedido, vende y cobra.
3. **Local de venta 2**: ídem local 1.

El diferencial del negocio es la **separación intencional entre producción y venta**. La materia prima se compra y procesa de forma centralizada; los locales solo reciben, cocinan y cobran. Hoy esta separación existe operativamente pero sin sistema: todo se controla en papel y Excel, con errores, nomenclaturas inconsistentes y puntos ciegos.

### 1.2 El problema que resuelve el sistema

**No hay control real del stock ni de la caja.** No pueden rastrear qué entró, qué se produjo, qué se vendió, qué se desperdició y qué se perdió (dinero en pérdida sin explicación). El objetivo del software es **trazabilidad completa desde que entra la materia prima hasta que se cobra al cliente**: todo registrado, todo con responsable, todo comparable contra lo que "debería ser".

### 1.3 Principio de diseño rector: EL CONTROL CIEGO

Este concepto atraviesa todo el sistema y es INNEGOCIABLE:

> **El empleado que carga un conteo nunca ve el valor esperado antes de cargar. El sistema compara internamente y solo informa las discrepancias al Administrador.**

Aplica a: arqueo de caja (apertura y cierre), arqueo de pollos marcados, recepción de transferencias, y rendimiento esperado de producción. La razón: si el empleado ve el número esperado, puede acomodar su conteo. El control ciego elimina esa posibilidad.

### 1.4 Volumen operativo (datos reales de planilla semanal)

- Facturación semanal: ~$12.8M ARS
- ~279 pedidos/semana, ~40 por turno, pico ~78 órdenes en un turno de domingo
- 5-6 usuarios concurrentes máximo
- 2 turnos/día (día y noche, horarios variables), 1 cajero por sucursal por turno
- Mercado Pago es el medio dominante (~61.5% de ventas), efectivo ~38.5%
- Hasta 10 proveedores, pedidos rutinarios
- **Conclusión: la carga es trivial para cualquier stack moderno. La complejidad está en el dominio, no en la escala.**

---

## 2. ROLES Y USUARIOS

| Rol | Quién | Permisos |
|---|---|---|
| **ADMINISTRADOR** | Pablo (administra el sistema) | Acceso total. CRUD de usuarios, productos, precios, fichas técnicas, stocks mínimos. Recibe TODAS las alertas (desvíos de producción, discrepancias de transferencia, discrepancias de caja, bloqueos, stock mínimo). Puede desbloquear turnos y generar claves de emergencia. Único rol que "mete mano" en datos. |
| **SOCIO** | Ariel, Eliana, Ema | **Solo lectura.** Ven reportes, informes, historial, auditoría. NO pueden modificar datos (pedido explícito de ellos: "que no rompamos nada sin querer"). |
| **ENCARGADO** | A definir | Operativo, sin acceso a información financiera ni reportes de rentabilidad. |
| **CAJERO** | Empleados de local | Opera POS, caja, arqueos, gastos, retiros, mermas. No ve montos esperados, diferencias de caja ni datos financieros. |
| **PRODUCCION** | Empleados de producción | Solo módulo de producción: ingresos de mercadería, lotes, transferencias salientes. Interfaz simplificada pensada para celular. No ve rendimientos esperados ni alertas. |

**Regla transversal**: TODA acción que modifica datos queda asociada al usuario que la ejecutó. El usuario es la "firma digital". Los usuarios no deben compartirse (validado con clientes).

---

## 3. STACK TECNOLÓGICO (DECIDIDO — NO CAMBIAR)

```
BACKEND
├── Node.js + TypeScript
├── Fastify (framework HTTP)
├── Prisma ORM
├── PostgreSQL 15
├── Socket.io (WebSockets para comandera y alertas en tiempo real)
├── JWT custom + refresh tokens en cookies httpOnly (NO usar servicios de auth de terceros)
└── Zod para validación de inputs

FRONTEND (YA CONSTRUIDO — carpeta frontend/, ver §4.1)
├── React 18 + TypeScript + Vite
├── Tailwind CSS v4 (tokens del diseño en src/index.css vía @theme)
├── react-router-dom v7 + @tanstack/react-query v5
├── Socket.io-client (alertas en tiempo real, solo rol ADMINISTRADOR)
└── PWA (React SPA con vite-plugin-pwa, NO Next.js)

INFRA
├── Neon (PostgreSQL) — desarrollo en free tier
├── Railway (backend en producción)
└── Vercel (frontend estático)

HARDWARE FUTURO
└── Impresora térmica de red Epson TM-T20 (ESC/POS directo desde backend) — módulo POS, fase posterior
```

### Decisiones de arquitectura ya tomadas (no rediscutir)

- **Web app cloud-hosted + PWA.** Descartados: Electron, offline-first distribuido, app nativa, Odoo.
- **NO offline en v1.** Fallback es papel (así operan hoy). Solo: banner de "sin conexión" + cache de catálogo vía Service Worker (fase front).
- **Multi-sucursal desde el día 1**: TODA tabla relevante lleva `sucursalId`. Hay 3 sucursales sembradas por seed: Producción, Local 1, Local 2. El sistema debe escalar a más locales sin refactor.
- **El arqueo/conteo ciego es SERVER-SIDE**: el backend NUNCA devuelve el valor esperado al frontend antes del conteo. La API responde solo "coincide / no coincide" (y en producción, ni eso al operario — solo registra).
- **AFIP/ARCA queda fuera de v1**, pero el modelo de ventas debe dejar campos previstos (CUIT, condición IVA, nro comprobante) para integración futura.

---

## 4. ORDEN DE DESARROLLO (PLAN ACORDADO CON EL CLIENTE)

El cliente pidió explícitamente **entregas por módulo, no big-bang** ("prefiero módulos chicos, entregas más chiquitas").

### FASE ACTUAL → Módulo 1: Producción + Stock + Transferencias (Flujos 1, 2 y 3)

**Orden de trabajo dentro de la fase:**
1. ✅ **Backend completo del módulo 1** con tests — TERMINADO (78/78 tests, ver README.md y HANDOFF-AUDITORIA.md).
2. ✅ **Frontend del módulo 1** — CONSTRUIDO y verificado end-to-end contra el backend real (ver §4.1).
3. ✅ **Auditoría completa de negocio/seguridad/UX** (2026-07-13, 234 ítems revisados) — 3 hallazgos (1 crítico, 2 medios), los 3 corregidos y verificados en vivo (ver §4.1 y §11).

### 4.1 Estado del FRONTEND del módulo 1 (construido 2026-07-12)

El frontend vive en `frontend/` (proyecto Vite independiente, sin monorepo tooling — se despliega separado del backend). Implementa el diseño aprobado por el cliente, entregado como prototipo interactivo de Claude Design en `Diseño frontend Módulo 1 Pollería/Limon y Chimi - Modulo 1.dc.html`. **Ese .dc.html es SOLO referencia visual** (usa un pseudo-framework de la herramienta de diseño); la implementación real es `frontend/`. Marca visual: "Limón & Chimi" (verde #1a7f3f, amarillo #f4c531, tipografía Archivo).

**Qué está implementado** (fiel al brief de `PROMPT-DISENO-FRONTEND.md`):
- **Login** único con detección de rol y accesos rápidos a los usuarios del seed.
- **Rol PRODUCCION** (mobile-first, marco de celular): menú de 3 botones + banner de lote abierto; wizard "Llegó mercadería" (proveedor con "Otro", líneas remito/pesado con teclado numérico, foto opcional, confirmación); wizard "Producir" (producto elaborado → insumos por partida con validación de restante → lote abierto → cerrar con unidades y desperdicio); wizard "Enviar a local" (destino, líneas en unidades con tope de stock); "Mis envíos".
- **Rol CAJERO/ENCARGADO** (tablet): entregas pendientes SIN cantidades, conteo ciego con teclado, resultado coincide (verde) / no coincide (pantalla NEUTRAL con "VOLVER A CONTAR" y "CONFIRMAR IGUAL", sin revelar diferencia), "Mis recepciones"; ENCARGADO además tab "Stock" de su local.
- **Rol ADMINISTRADOR/SOCIO** (dashboard con sidebar): Alertas (con badge en vivo vía Socket.io + marcar vista), Stock por sucursal + movimientos con filtros, Producción (esperado vs. real, desvío en rojo, trazabilidad de insumos por partida), Transferencias (enviado/recibido/diferencia/firmas), Fichas técnicas (crear ficha y nueva versión — la anterior se desactiva), Catálogo (productos, precios con historial, proveedores, sucursales), Usuarios (solo admin), Auditoría con filtros. **SOCIO no ve ningún botón de escritura** (`puedeEscribir = rol === 'ADMINISTRADOR'`); Alertas y Usuarios ni aparecen en su menú.
- **Auth**: accessToken en memoria (NUNCA localStorage), refresh silencioso al montar vía cookie httpOnly, retry automático en 401. En dev el proxy de Vite hace todo same-origin (`/api`, `/uploads`, `/socket.io` → localhost:3000).
- **Control ciego respetado en UI**: las pantallas de PRODUCCION no tienen ningún espacio/campo para esperado-desvío-alerta; el receptor jamás ve `cantidadEnviada` (la API ya no la manda, y la UI tampoco deja hueco visual que la insinúe).
- **PWA**: manifest + service worker con cache de catálogo (productos/proveedores/sucursales) + banner "Sin conexión". NO hay offline real (decisión de §3).

**Estado de verificación**: ✅ **verificación end-to-end COMPLETADA (2026-07-12)** contra el backend real (Neon nuevo, ver abajo). Se recorrió en el navegador: ingreso con proveedor real y cantidades remito≠pesado (stock sube por lo pesado: 9.8, no 10) → lote de producción con partida trazable, validación bloqueante probada ("No alcanza. En esa partida quedan 8,2 kg"), cierre con desvío -36,84% → alerta DESVIO_PRODUCCION solo al admin → transferencia T-1 → recepción ciega como cajero con conteo errado (pantalla neutral "Los números no coinciden") → recontar correcto → CONFIRMADA, stock del local +6. **Campos ciegos verificados en el JSON crudo de Network**: el rol PRODUCCION nunca recibió `unidadesEsperadas`/`desvioPct`/`alertaDisparada`; el CAJERO nunca recibió `cantidadEnviada`/`diferencia`; el ADMIN sí ve todo. Auditoría registró las 6 acciones de la cadena. También verificado: errores de negocio del backend se muestran legibles en la UI (ej: desperdicio > insumo principal).

**Auditoría completa (2026-07-13)**: se revisaron 234 ítems de reglas de negocio, RBAC, control ciego y UX contra el backend real corriendo (matriz de RBAC en vivo con los 5 roles, boundary tests de stock, ataques directos al constraint de DB, rotación de tokens, etc.), más los 66 tests. Resultado: **1 hallazgo crítico** (aislamiento de sucursal en transferencias — ver §11) y **2 medios** (JWT secrets sin validar al arrancar, ficha técnica faltante de "Pollo a la parrilla"). Los 3 ya están corregidos y reverificados en vivo.

**Decisiones de frontend tomadas sin validar con el cliente** (revisar en próxima reunión):
- "Mis envíos"/"Mis recepciones" filtran client-side por username (el endpoint de transferencias no filtra por emisor/receptor). Aceptable al volumen actual.
- Ícono PWA es un SVG placeholder con "L&C" — falta arte de marca real (PNG 192/512).
- La pantalla de Usuarios del admin ahora tiene selector de sucursal para CAJERO/ENCARGADO (ver §11, `Usuario.sucursalId`) — falta validar con el cliente si ENCARGADO/CAJERO alguna vez rotan de local (hoy es 1 sucursal fija por usuario, sin historial de cambios).

**Comandos**: `cd frontend && npm run dev` (:5173, requiere backend en :3000) · `npm run build` · `npx tsc -b --noEmit`.

### FASES FUTURAS (para conocimiento, NO desarrollar todavía)
- **Módulo 2**: POS + Caja y Turnos (Flujos 4 y 5) — van juntos, la venta requiere turno abierto.
- **Módulo 3**: Alertas de stock mínimo + Reportes y dashboard (Flujos 6 y 7 visibles).
- **Futuro lejano** (fuera de v1): conciliación Mercado Pago/bancos, facturación ARCA/AFIP, pedidos WhatsApp, OCR de remitos.

**IMPORTANTE**: aunque solo se desarrolla el módulo 1 ahora, las tablas transversales (Usuario, Producto, Sucursal, MovimientoStock, RegistroAuditoria, Precio) se diseñan COMPLETAS desde el inicio porque las usan todos los módulos. La auditoría nace en el módulo 1, no se agrega después.

---

## 5. FLUJO 1 — INGRESO DE MATERIA PRIMA (implementar ahora)

**Actores**: Proveedor (externo) · Usuario PRODUCCION · Sistema

### Lógica paso a paso

1. Llega el proveedor con mercadería y remito/factura.
2. El usuario de producción **pesa y cuenta físicamente** cada producto.
3. Carga el ingreso en el sistema (pensado para usarse desde celular):
   - **Proveedor**: de lista precargada (máx ~10). Debe existir una opción **"Otro"** que habilita un campo de comentario libre (para proveedores excepcionales).
   - **Fecha/hora**: automáticas.
   - **Foto del remito**: adjunta opcional. Solo respaldo visual, el sistema NO la procesa (OCR es futuro lejano).
   - **Líneas de ingreso**: por cada producto → tipo de materia prima, **cantidad según remito** Y **cantidad real pesada**. Ambos campos. La diferencia queda registrada implícitamente.
4. Validación: proveedor obligatorio, al menos una línea, cantidades > 0. Si falta algo → error, no avanza.
5. **Cada línea de ingreso queda como LOTE DE INGRESO identificable** (ej: "10 kg de nalga del 3/7"). NO se funde en un pool genérico. Esto es la base de la trazabilidad por partida: producción después trabaja "sobre" una línea de ingreso específica.
6. El stock de materia prima de la sucursal Producción se incrementa (vía MovimientoStock tipo `INGRESO_COMPRA`).
7. Todo queda en historial y auditoría: proveedor, fecha, usuario, foto, diferencia remito vs. real.

### Reglas de negocio críticas del Flujo 1
- **TODOS los insumos pasan por acá**: carnes, pan rallado, huevos, condimentos, papas. Todo producto tiene su stock.
- Se registra siempre el peso REAL medido, no el del remito. El remito es referencia comparativa.
- Cada línea mantiene su **cantidad restante disponible** (se va consumiendo a medida que producción la usa).

---

## 6. FLUJO 2 — PRODUCCIÓN Y CONVERSIÓN (implementar ahora)

**Actores**: Usuario PRODUCCION · Sistema · ADMINISTRADOR (recibe alertas)

Es el flujo más crítico del sistema. Convierte kilos de materia prima en unidades vendibles y detecta desvíos.

### Lógica paso a paso

1. El usuario inicia un **lote de producción**: elige qué producto elaborado va a producir (ej: milanesa de nalga).
2. **Selecciona sobre qué LOTE(S) DE INGRESO trabaja**: el sistema muestra las líneas de ingreso con stock restante de la materia prima principal (ej: "10 kg nalga del 3/7", "8 kg nalga del 5/7") y el usuario elige. Trazabilidad por partida confirmada por el cliente.
3. **Carga TODOS los insumos que usa, no solo la carne**: kg de nalga, cantidad de huevos, kg de pan rallado, condimentos. Cada insumo referencia su línea de ingreso de origen y se descuenta de su propio stock.
4. **VALIDACIÓN BLOQUEANTE de stock**: si el usuario intenta cargar una cantidad mayor al stock disponible de CUALQUIER insumo → error "stock insuficiente" y **NO puede continuar hasta ingresar un valor válido**. NUNCA permitir stock negativo (contaminaría todo el sistema). Si el problema es un ingreso no cargado, debe ir al Flujo 1 primero.
5. **El sistema calcula internamente el rendimiento esperado** según la ficha técnica vigente (unidades que deberían salir, desperdicio esperado). **ESTE CÁLCULO NO SE MUESTRA NUNCA AL USUARIO DE PRODUCCIÓN** (ni en la API ni en el front). Es control ciego: si el operario sabe que "deberían salir 52", acomoda la carga.
6. El usuario produce físicamente y carga el resultado real: **unidades producidas** + **kg de desperdicio real**.
7. El sistema calcula: rendimiento real, % desperdicio real, desvío vs. ficha técnica.
   - Si el desvío supera el **umbral configurable** de la ficha técnica → genera **Alerta silenciosa SOLO para el Administrador** (producto, lote, operario, esperado, real, desvío). El operario jamás la ve ni sabe que se disparó.
   - El flujo NO se bloquea por desvío. Solo alerta.
8. Al cerrar el lote, el sistema ejecuta atómicamente (transacción):
   - Descuenta cada insumo usado de su stock y de su línea de ingreso (MovimientoStock `CONSUMO_PRODUCCION` por insumo)
   - Suma las unidades producidas al stock de producción (MovimientoStock `PRODUCCION_ALTA`)
   - Registra el desperdicio (MovimientoStock `DESPERDICIO_PRODUCCION`)
9. El lote queda en historial con **la versión de ficha técnica congelada** (referencia a la versión, no a la ficha madre).

### Fichas técnicas y versionado (CRÍTICO)

- Cada producto elaborado tiene UNA ficha técnica con N **versiones**. Solo UNA versión activa a la vez.
- La versión contiene: número, fecha desde, activa, **rendimiento esperado**, **% desperdicio esperado**, **umbral de desvío para alerta**, y la lista de **ingredientes con cantidad por unidad producida** (ej: 180g nalga + 50g pan rallado + 0.5 huevo por milanesa).
- **Modificar una receta = crear versión nueva + desactivar la anterior. NUNCA editar una versión existente.** Los lotes históricos apuntan a la versión que estaba vigente cuando se produjeron; los reportes históricos jamás se alteran por cambios de receta.
- Las fichas técnicas las carga inicialmente el equipo (migración desde Excel del cliente — **el Excel de fichas técnicas AÚN NO FUE ENTREGADO por el cliente**, usar datos de ejemplo realistas en seeds). A futuro las modifica solo el ADMINISTRADOR.

---

## 7. FLUJO 3 — TRANSFERENCIA INTERNA / REMITO VIRTUAL (implementar ahora)

**Actores**: Usuario PRODUCCION (emisor) · Usuario del local (receptor) · Sistema · ADMINISTRADOR (alertas)

El movimiento de unidades desde Producción hacia los locales de venta. El cliente lo llama "remito virtual": reemplaza el remito de papel, y las firmas son los usuarios.

### Lógica paso a paso

1. **Producción genera la transferencia**: sucursal destino (Local 1 o 2), producto(s), **cantidad en UNIDADES** (a esta altura ya no son kilos). El sistema valida stock disponible; si no alcanza, **no deja generar el envío**. Al confirmar:
   - Estado → `PENDIENTE_RECEPCION`
   - Stock de producción se descuenta (MovimientoStock `TRANSFERENCIA_SALIDA`)
   - Queda firmado por el **usuario emisor**
2. Traslado físico (fuera del sistema).
3. **El local recibe — CONTEO CIEGO**: el usuario del local ve la transferencia pendiente (producto y origen) pero **NUNCA ve la cantidad enviada**. Cuenta físicamente y carga su número. Su usuario es la firma de recepción.
4. El sistema compara internamente:
   - **Coinciden** → estado `CONFIRMADA`, stock del local se incrementa (MovimientoStock `TRANSFERENCIA_ENTRADA`).
   - **No coinciden** → respuesta a la UI: "los números no coinciden, ¿recontar o confirmar igual?" **SIN revelar la diferencia ni de qué lado está el error**. Dos caminos:
     - **Recontar**: vuelve a cargar, se compara de nuevo. Iterable sin límite.
     - **Confirmar igual**: estado `CONFIRMADA_CON_DISCREPANCIA`. El stock del local se actualiza con **la cantidad declarada por el receptor**. Se genera **Alerta al Administrador** con: producto, cantidad enviada, cantidad recibida, diferencia, fecha/hora, usuario emisor Y usuario receptor.
5. **El sistema nunca se bloquea** por discrepancia de transferencia. La operación sigue.
6. Historial completo: remito virtual, ambas firmas, discrepancia si existió.

---

## 8. FLUJOS FUTUROS (NO IMPLEMENTAR AHORA — solo contexto para diseñar bien las tablas transversales)

### Flujo 4 — Venta en POS (módulo 2)
- Pantalla táctil, botones grandes por categoría, **productos ordenados por más vendidos** (pedido explícito del cliente para velocidad).
- Pedidos: presencial (cobra al momento) o a retirar (cobra cuando el cliente llega).
- **El stock se descuenta al CONFIRMAR el pedido (cuando se manda a preparar), NO al cobrar** — decisión explícita de Ariel: si se preparó, se consumió, se retire o no.
- Estados del pedido: `EN_PREPARACION → LISTO → ENTREGADO` | `LISTO_NO_RETIRADO → REASIGNADO / PERDIDO` | `ANULADO`.
- Pedido no retirado: puede reasignarse a otro cliente o marcarse perdido (pasa a merma).
- Anulación: repone stock, imprime ticket de anulación en cocina, registro completo del pedido tal como estaba.
- Pagos combinables: efectivo, débito, crédito, MP/QR, transferencia. Vuelto automático.
- Atenciones/regalías: producto sin cargo con motivo + responsable. Descuenta stock.
- **Venta a costo cero**: mecanismo para mermas — tipo `DESPERDICIO_QUEMADO` (pollo/milanesa/empanada quemados: stock muere, agrupa para reporte "esta semana se quemaron X") o tipo `RETORNO_A_PRODUCCION` (producto vuelve como insumo a producción, ej: pollo no vendido → empanadas de pollo). No mueve caja.
- **Circuito especial del POLLO** (solo pollos por ahora): stock en 3 etapas → fresco (llega por transferencia) → **MARCADO** (tirado a la parrilla, registrado por evento de marcado) → vendido. La venta descuenta de MARCADOS, no de fresco. Los marcados tienen arqueo ciego propio en apertura/cierre de caja. Pollo se vende por porción: **entero o medio** (esto reemplaza variantes por acompañamiento) — el "medio" es un evento de VENTA (partir un pollo cocinado entero), NO de producción; el módulo 1 solo produce "Pollo a la leña (entero)" completo (ver §9).
- **Combos/promos — MODELADO 2026-07-13** (adelantado desde módulo 1, ver §9 `Producto` tipo `COMBO` + `ComboComponente`): el precio del combo es un dato propio cargado a mano (mismo mecanismo de `Precio` que cualquier producto, con historial), **no un descuento calculado**. Cuando exista el POS: vender un combo descuenta stock de cada componente por su cantidad, nunca del combo en sí (que no tiene stock propio). Pendiente: cargar los combos reales de la carta (ver §11 — carta del cliente, faltan 2 imágenes).
- Comandera: ticket a impresora térmica de red vía ESC/POS desde el backend.

### Flujo 5 — Caja y Turnos (módulo 2)
- Apertura: login → arqueo DOBLE y CIEGO (efectivo + pollos marcados) → sistema compara contra cierre anterior y **calcula faltante/sobrante automáticamente** como ítem del turno.
- Discrepancia → turno BLOQUEADO, mensaje genérico sin montos. Notificación SOLO al Administrador (nunca a los cajeros) incluyendo cajero del cierre anterior + cajero actual.
- Desbloqueo: (a) remoto desde panel del admin, o (b) **clave de emergencia**: opción discreta en pantalla de bloqueo, código de un solo uso generado por el admin, expira a los 10 minutos. Todo registrado.
- Durante el turno: gastos de caja (monto + medio efectivo/MP + categoría de lista u "otro"), **retiros parciales** (monto + medio + cuál de los TRES SOCIOS retiró: Ariel/Eliana/Ema — selector cerrado).
- Cierre: arqueo doble ciego → el sistema cruza todo → **el cajero NO ve la diferencia de caja ni datos financieros**; solo ve resumen de ventas POR UNIDAD (sin plata) + conteo final de pollos marcados. El resumen financiero completo va a Admin y Socios.
- Saldos finales (dinero + pollos marcados) quedan como referencia ciega del turno siguiente.

### Flujo 6 — Alertas de stock mínimo (módulo 3)
- Stock mínimo configurable por producto y por sucursal (solo Admin).
- Bajo el mínimo → pop-up en POS **repetido en CADA venta** mientras siga bajo ("que le seque la cabeza al cajero" — textual del cliente). No bloquea mientras haya stock.
- **Stock CERO → BLOQUEO REAL de la venta.** No se puede facturar lo que no hay. (Quedan 5 milanesas y piden 10 → no deja cargar 10.)
- Notificación al Admin al cruzar el mínimo. Alerta se desactiva sola al reponerse.

### Flujo 7 — Auditoría y trazabilidad (transversal, NACE EN EL MÓDULO 1)
- Registro inmutable de toda acción que modifica datos: qué pasó, sobre qué objeto (tipo+id), quién, cuándo, **datos anteriores y datos nuevos** (JSON).
- No editable, no borrable, historial permanente sin límite.
- Consulta (Admin/Socios) con filtros: fecha, usuario, tipo de acción, módulo, sucursal.
- Registro reforzado en 4 casos: anulaciones (pedido completo), discrepancias de transferencia (ambos números + ambos usuarios), desbloqueos de caja, cambios de precio (anterior + nuevo + quién + cuándo).
- Reportes prioritarios para Socios: discrepancias y finales de caja, retiros por socio, ventas por producto vs. semana anterior, quemados por producto, rendimientos y desvíos de producción.

---

## 9. MODELO DE DOMINIO → SCHEMA (guía para Prisma)

### Entidades transversales (crear completas AHORA)

- **Sucursal**: nombre, tipo (`PRODUCCION` | `VENTA`), dirección, activa. Seed: 3 sucursales.
- **Usuario**: nombre, username, passwordHash, rol (`ADMINISTRADOR` | `SOCIO` | `ENCARGADO` | `CAJERO` | `PRODUCCION`), activo, **sucursalId** (opcional, FK a Sucursal — fija de qué local es un CAJERO/ENCARGADO; `transferencias.service.ts` la usa para que solo puedan recepcionar transferencias de su propia sucursal).
- **Producto**: nombre ÚNICO, categoría, tipo (`MATERIA_PRIMA` | `ELABORADO` | `REVENTA` | `COMBO`), unidadDeMedida (`KG` | `UNIDAD`), activo. Nota: materia prima y producto vendible son la MISMA entidad con tipos distintos (el pollo cocido que retorna a producción es insumo de la empanada).
- **Precio**: producto, monto, **cantidad** (agregado 2026-07-13, default 1), fechaDesde, usuario. Historial: nunca se pisa, cambio = registro nuevo (el nuevo registro es para la MISMA `cantidad`, no reemplaza otras cantidades). Para un producto normal siempre hay una sola cantidad (1). Para un `COMBO`, `cantidad` permite una **tabla de precio por volumen no lineal** — dato real relevado de la planilla operativa del cliente ("REFERENCIAS"): pedir 2 casi nunca cuesta 2× el precio de 1 (ej: "Pollo c/Fritas Grandes" ×1 = $29.000, ×2 = $56.000, no $58.000). `productos.service.ts::tablaPrecioVigente()` devuelve, para cada cantidad que alguna vez tuvo un precio, el vigente más reciente.
- **ComboComponente** (agregado 2026-07-13, propuesta validada con el cliente): combo (Producto tipo `COMBO`), productoComponente (Producto — nunca otro `COMBO`, no se permiten combos anidados), cantidad. Define de qué se arma un combo. Sin versionado (a diferencia de FichaTecnicaVersion): editar la composición reemplaza la lista completa, no hay lotes históricos que deban "congelar" una composición pasada. El combo no tiene stock ni movimientos propios — cuando exista el POS (módulo 2), vender un combo debe generar `MovimientoStock` de tipo `VENTA` sobre cada componente por su cantidad, nunca sobre el combo. CRUD en `src/modules/productos/{productos.service,productos.routes}.ts` (`POST /productos/combos`, `PATCH /productos/combos/:id/componentes`), UI en la pestaña "Combos" del Catálogo admin.
- **MovimientoStock** (LA ENTIDAD CENTRAL): producto, sucursal, tipo, cantidad (+/-), fecha/hora, usuario, referencia polimórfica al documento origen (tipoOrigen + origenId). Tipos: `INGRESO_COMPRA`, `CONSUMO_PRODUCCION`, `PRODUCCION_ALTA`, `DESPERDICIO_PRODUCCION`, `TRANSFERENCIA_SALIDA`, `TRANSFERENCIA_ENTRADA`, `VENTA`, `ANULACION_REPOSICION`, `ATENCION`, `MERMA_QUEMADO`, `RETORNO_A_PRODUCCION`, `MARCADO_POLLO`, `AJUSTE`. El stock actual de un producto en una sucursal = SUM(movimientos). Puede materializarse en tabla StockActual por performance, pero la fuente de verdad son los movimientos.
- **RegistroAuditoria**: accion, entidad, entidadId, usuarioId, fechaHora, datosAnteriores (JSON), datosNuevos (JSON). Inmutable (sin UPDATE/DELETE en la capa de servicio).
- **Alerta**: tipo (`DESVIO_PRODUCCION` | `DISCREPANCIA_TRANSFERENCIA` | `DISCREPANCIA_CAJA` | `BLOQUEO_TURNO` | `STOCK_MINIMO`), referencia al objeto disparador, fechaHora, vista (bool). Destinatario: rol ADMINISTRADOR.

### Entidades del módulo 1 (crear AHORA)

- **Proveedor**: nombre, contacto, activo, esOtro (bool para el proveedor genérico "Otro").
- **IngresoMercaderia**: proveedor, comentarioProveedorOtro (nullable), sucursal (siempre Producción), fechaHora, usuario, fotoRemitoUrl (nullable).
- **LineaIngreso** (= lote de ingreso trazable): ingresoMercaderia, producto, cantidadSegunRemito, cantidadRealPesada, cantidadRestanteDisponible.
- **FichaTecnica**: productoElaborado (1 a 1 con Producto tipo ELABORADO).
- **FichaTecnicaVersion**: fichaTecnica, numeroVersion, fechaDesde, activa, rendimientoEsperado, desperdicioEsperadoPct, umbralDesvioAlertaPct. Constraint: una sola activa por ficha.
- **IngredienteDeReceta**: fichaTecnicaVersion, productoInsumo, cantidadPorUnidadProducida, **esPrincipal** (bool — exactamente UN ingrediente por versión). NOTA: `esPrincipal` es una decisión técnica del equipo, no validada aún con el cliente: marca el insumo base del cálculo de rendimiento (ej: la nalga en la milanesa). La fórmula implementada es `unidadesEsperadas = (cantidadInsumoPrincipal / cantidadPorUnidadProducida) × (1 − desperdicioEsperadoPct/100)`, y el desperdicio real se descuenta solo del insumo principal. **Confirmar ambas cosas contra el Excel de fichas técnicas del cliente cuando llegue** — si su lógica de rendimiento es otra, rehacer `src/modules/produccion/produccion.calculos.ts`.
- **LoteDeProduccion**: productoElaborado, fichaTecnicaVersion (congelada), fechaHora, usuarioOperario, unidadesProducidasReales, desperdicioRealKg, unidadesEsperadas (calculado, NUNCA expuesto al rol PRODUCCION), desvioPct (calculado), alertaDisparada (bool), estado (`ABIERTO` | `CERRADO`).
- **InsumoUsado**: loteDeProduccion, productoInsumo, lineaIngresoOrigen, cantidadUsada.
- **Transferencia**: sucursalOrigen, sucursalDestino, fechaHoraEnvio, usuarioEmisor, usuarioReceptor (nullable hasta recepción), fechaHoraRecepcion (nullable), estado (`PENDIENTE_RECEPCION` | `CONFIRMADA` | `CONFIRMADA_CON_DISCREPANCIA`).
- **LineaDeTransferencia**: transferencia, producto, cantidadEnviada (visible solo para PRODUCCION emisor y ADMIN), cantidadRecibida (nullable), diferencia (calculada).

### La cadena de trazabilidad (el corazón del sistema)

```
LineaIngreso → InsumoUsado → LoteDeProduccion → LineaDeTransferencia → (futuro: ItemDePedido)
```

Debe poder responderse: "esta milanesa vendida el viernes salió de la entrega de nalga del proveedor X del 3/7, producida por el operario Y en el lote Z con la versión 2 de la receta".

---

## 10. REGLAS DE IMPLEMENTACIÓN DEL BACKEND

### Arquitectura
- Estructura por módulos de dominio: `src/modules/{auth, usuarios, productos, ingresos, produccion, transferencias, stock, auditoria, alertas}` con capas `routes → controllers → services → repositories (Prisma)`.
- Validación de entrada con Zod en cada endpoint.
- **RBAC en middleware**: cada endpoint declara qué roles pueden accederlo. El control ciego también es responsabilidad de la capa de serialización: los DTOs de respuesta para rol PRODUCCION nunca incluyen `unidadesEsperadas`, `desvioPct` ni datos de alerta; los DTOs de recepción de transferencia nunca incluyen `cantidadEnviada` para el receptor.
- Toda operación multi-tabla va en **transacción Prisma** (`$transaction`). En particular: cierre de lote de producción, generación y confirmación de transferencia, registro de ingreso.
- La auditoría se implementa en la capa de servicio (helper `registrarAuditoria()` llamado dentro de la misma transacción). No usar triggers de DB para mantener testeabilidad.
- Seeds: 3 sucursales, usuarios de cada rol, ~10 proveedores + "Otro", catálogo de productos realista de pollería (nalga, pan rallado, huevo, condimentos, papas, pollo fresco, milanesa de nalga, empanada de pollo, etc.), fichas técnicas de ejemplo con versión activa (datos inventados razonables — el Excel real del cliente aún no llegó).

### Testing (OBLIGATORIO antes de pasar al front)
- **Unitarios** (lógica pura de servicios): cálculo de rendimiento esperado y desvío, disparo de alerta por umbral, validación bloqueante de stock insuficiente, consumo de líneas de ingreso (descuento de cantidadRestanteDisponible), comparación ciega de transferencias, versionado de fichas (crear versión nueva desactiva la anterior; lote apunta a versión congelada).
- **Integración** (endpoints con DB de test): flujo completo ingreso → lote → transferencia → recepción con y sin discrepancia; verificación de que el stock cuadra vía MovimientoStock en cada paso; verificación de RBAC (403 para roles indebidos); verificación de que las respuestas para PRODUCCION no filtran campos ciegos (esto es un test de seguridad, no opcional); inmutabilidad de auditoría; **aislamiento por sucursal** (un CAJERO/ENCARGADO no puede ver ni recepcionar transferencias de OTRO local — agregado tras hallazgo de auditoría, ver §11).
- Framework sugerido: Vitest + Supertest (o fastify.inject). DB de test con Prisma + PostgreSQL (docker-compose o Neon branch).

### Convenciones
- Código, comentarios y nombres de dominio en español (el equipo y el cliente hablan español; las entidades del negocio ya tienen nombres en español).
- Errores de negocio con códigos claros (`STOCK_INSUFICIENTE`, `FICHA_SIN_VERSION_ACTIVA`, `TRANSFERENCIA_YA_CONFIRMADA`, etc.).
- Fechas en UTC en DB, zona `America/Argentina/Cordoba` en presentación.
- Moneda: ARS, guardar montos como Decimal (no float).

---

## 11. PENDIENTES CONOCIDOS (no bloquean el módulo 1)

- **Excel de fichas técnicas reales**: el cliente (Eliana) lo debe, está "recortando datos sensibles". Usar seeds de ejemplo mientras tanto.
- Persona concreta para rol ENCARGADO: sin definir.
- Canal exacto de notificación de alertas al admin (in-app vs email): implementar in-app + WebSocket ahora, email evaluable después.
- Hardware del POS (tablet vs PC) y compra de impresoras: decisión del cliente, no afecta módulo 1.
- Conciliación MP/banco, ARCA/AFIP, WhatsApp, OCR: futuro, NO diseñar ahora (solo no cerrarles la puerta en el modelo de ventas cuando llegue el módulo 2).
- **Fotos de remito — infraestructura pendiente**: hoy `POST /api/ingresos/foto` guarda en disco local (`uploads/remitos/`). Railway tiene filesystem efímero: cada redeploy borra los archivos. **Antes de producción migrar a S3/Cloudinary/R2** (cambio chico, ~15 min una vez decidido el proveedor). En desarrollo local funciona bien.
- **Roles habilitados para recepcionar transferencias**: CAJERO, ENCARGADO y ADMINISTRADOR (decisión técnica razonable, no confirmada con el cliente — preguntar en próxima reunión).
- **Cookie de refresh `sameSite: 'strict'`**: rompe el refresh silencioso si frontend (Vercel) y backend (Railway) quedan en dominios distintos en producción. Antes de desplegar en dominios separados: cambiar a `'lax'` o `'none' + secure` en `src/modules/auth/auth.routes.ts`, o servir ambos bajo el mismo dominio.
- ~~Verificación end-to-end del frontend~~: ✅ hecha el 2026-07-12 (ver §4.1).
- **Base Neon NUEVA (2026-07-12)**: el proyecto Neon original del README ya no existe. La DB actual es el proyecto con host `ep-bold-flower-acc36pom-pooler.sa-east-1.aws.neon.tech`, base `neondb` (dev, migrada y seedeada) y `polleria_test` (tests). Credenciales en `.env` local (no versionado). El README menciona el proyecto viejo — referencia histórica.
- ~~Sucursal del CAJERO/ENCARGADO~~: ✅ resuelto el 2026-07-13. `Usuario.sucursalId` (opcional, FK a Sucursal) agregado al modelo. El admin la asigna desde la pantalla de Usuarios (solo aparece para CAJERO/ENCARGADO). El frontend usa esa sucursal fija sin selector cuando está asignada; el selector manual queda solo como red de contención para cuentas sin sucursal configurada.
- **Aislamiento de sucursal en transferencias — hallazgo de auditoría, ya arreglado (2026-07-13)**: sin `sucursalId` en `Usuario`, cualquier CAJERO/ENCARGADO podía ver y confirmar la recepción de transferencias dirigidas a OTRO local (reproducido en vivo durante la auditoría del módulo 1 — ver artifact de auditoría). `transferencias.service.ts` ahora valida `usuario.sucursalId === transferencia.sucursalDestinoId` en `intentarRecepcion`/`confirmarConDiscrepancia` (siempre releído de la DB, nunca confiado del JWT), y `GET /transferencias` fuerza el filtro a la sucursal propia para esos roles. ADMINISTRADOR sigue exento (acceso total). Test de integración dedicado en `flujo-completo.test.ts`.
- ~~Servidor arrancaba con `JWT_SECRET`/`JWT_REFRESH_SECRET` por defecto si faltaban~~: ✅ arreglado el 2026-07-13 (hallazgo de auditoría §0.1). `src/config.ts` ahora aborta el arranque (`process.exit(1)`) con mensaje claro si `NODE_ENV=production` y falta cualquiera de los dos secretos. En desarrollo/test el fallback sigue funcionando igual que antes. Verificado en vivo simulando ambos escenarios.
- ~~"Pollo a la parrilla (porción)" sin ficha técnica~~: ✅ arreglado el 2026-07-13 (hallazgo de auditoría §0.2), y **corregido de nuevo el mismo día** al ver la carta real del cliente: se renombró a **"Pollo a la leña (entero)"** y se creó la versión 2 de su ficha (1 pollo entero fresco → 1 pollo a la leña entero, no "0.25 → 4 porciones" como se había inventado antes). La versión 1 (incorrecta) queda desactivada pero visible en el historial — ningún lote real la usó. Ver también la nota sobre "medio" en §8 Flujo 4.
- ~~Carta real del cliente — carga pendiente~~: ✅ cargada el 2026-07-13. Además de las 6 fotos del menú (POLLO C/FRITAS, MILAS, LOMOS, BURGERS, papas/ensaladas/escabeches/empanadas, Sorrentinos/Tartas), el cliente pasó **"planilla semanal 04-05-2026.xlsx"** — la planilla operativa real que ya citábamos en §1.4 (facturación semanal, confirmado: el total de esa semana da $12.848.750, coincide exacto). Su hoja "REFERENCIAS" es la fuente de verdad de precios: **se decidió que manda sobre las fotos del cartel**, que en varios ítems estaban desactualizadas (ej. Combo pollo+fritas grande: cartel $28.000 vs planilla real $29.000; sandwich mila completo: $17.000 vs $16.000; hamburlomo: $13.000 vs $14.500 — hay más casos, ver historial de la sesión). 58 productos + 4 combos reales cargados en `prisma/seed.ts` con su precio y, donde la planilla lo daba, su tabla de precio por cantidad (1 a 5, y hasta 36 para empanadas).
  - **Supuestos tomados que el cliente debería confirmar**: (a) los 3 estilos de hamburguesa (Classic/Intense/Luxury) se cargaron todos al MISMO precio por talle (simple/doble/triple) porque la planilla no los distingue — puede que en la práctica cobren distinto; (b) "Empanada de pollo" y "Empanada de carne" comparten la misma tabla de precio por volumen — un pedido de 12 empanadas MEZCLANDO sabores no está modelado (eso es un problema de motor de precios del futuro POS, no de catálogo); (c) las 3 ensaladas del cartel (Especial/Común/Rusa) se cargaron todas a $5.000 porque la planilla trackea una sola categoría "ENSAL." sin distinguir.
  - **Bebidas NO tienen precio fijo**: la planilla muestra que cada pedido de bebida se anota con descripción libre y precio variable según marca/tamaño ("PEPSI 2LTS $2.000", "SCHWEPPES 2,25LTS $5.500"). No se creó un catálogo de gaseosas con precio fijo más allá de la "Gaseosa 500ml" que ya existía de una sesión anterior — cuando llegue el POS (módulo 2) las bebidas van a necesitar un mecanismo de precio libre por línea de venta, no el catálogo de `Producto`/`Precio` estándar.
  - Sorrentinos y Tartas no estaban en la planilla de referencias (posible incorporación posterior a la carta) — su precio sale del cartel únicamente, sin tabla por cantidad.

---

## 12. CRITERIO DE "MÓDULO 1 TERMINADO"

**Estado: backend ✅ terminado y testeado · frontend ✅ construido y verificado end-to-end contra el backend real (§4.1) · auditoría completa ✅ hecha y los 3 hallazgos corregidos (§11). MÓDULO 1 COMPLETO.**

El backend del módulo 1 está terminado cuando:
1. Un usuario PRODUCCION puede registrar un ingreso con múltiples líneas, foto y proveedor "Otro".
2. Puede abrir un lote eligiendo líneas de ingreso específicas, cargar todos los insumos (con bloqueo real por stock insuficiente), cerrar el lote con unidades y desperdicio reales, y el sistema calcula desvío y dispara alerta al admin si supera el umbral — sin exponer jamás el esperado al operario.
3. Puede generar una transferencia que descuenta stock de producción, y un usuario del local puede recibirla a ciegas, recontar o confirmar con discrepancia, generando la alerta correspondiente — SOLO si ese usuario pertenece a la sucursal destino (§11).
4. El stock de cualquier producto en cualquier sucursal es consultable y cuadra exactamente con la suma de sus MovimientoStock.
5. Toda la cadena es trazable de punta a punta y auditada.
6. Todos los tests pasan (78/78), incluidos los de no-filtración de campos ciegos, RBAC, aislamiento de sucursal, combos y precio por cantidad.