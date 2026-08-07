# CLAUDE.md — Documento Maestro del Sistema
## Sistema de Gestión para Pollería "Limón & Chimi" — Córdoba, Argentina

> **Propósito de este documento**: contexto completo, autoritativo y final del proyecto. Todo lo que está acá fue definido y validado con los clientes (Ariel, Eliana y Pablo). No inventar lógica de negocio que contradiga este documento. Si algo no está definido acá, está marcado explícitamente como pendiente — preguntar antes de asumir. Este documento reemplaza cualquier versión anterior de CLAUDE.md.
>
> **Última actualización: 2026-08-06** — se cierra la decisión de hardware y diseño de las comanderas (impresoras de cocina): modelo XPRINTER XP-V320N, 2 unidades por local (COCINA + MOSTRADOR), conexión ESC/POS por red, configuración de IP desde el panel admin. Ver §4 (Stack), §5 Flujo 4 (Comandera), §6 (modelo de datos), §7 (RBAC), §9 (estado del proyecto) y §10 (pendientes). Pendiente de implementación real (hoy sigue como mock).
>
> **Verificación contra el código (2026-08-06)**: al incorporar este documento al repo se contrastó cada afirmación de estado contra el código real de `feature/modulo-2` (commit `9e67f86`). Se corrigieron tres definiciones del §6 que contradecían el `schema.prisma` vigente (`Turno.id`, `model Combo`, `comboId`) y varias filas de §9/§10 que daban por pendiente trabajo ya entregado. Las correcciones están marcadas con «✔ verificado» o «CORREGIDO». **La lógica de negocio no se tocó** — solo afirmaciones sobre el estado del código, que son verificables.

---

## 1. CONTEXTO DEL NEGOCIO

### 1.1 Descripción del negocio

Pollería gastronómica en Córdoba, Argentina. Vende pollos, milanesas, lomitos, empanadas, hamburguesas, papas fritas y productos relacionados. Opera en **tres ubicaciones físicas**:

1. **Producción (central)**: llega la materia prima en bruto (por kilo), se transforma en unidades listas para cocinar.
2. **Local de venta 1 (Limón y Chimi)**: recibe unidades ya producidas, cocina a pedido, vende y cobra.
3. **Local de venta 2**: ídem local 1.

El diferencial del negocio es la **separación intencional entre producción y venta**. La materia prima se compra y procesa centralmente. Los locales solo reciben, cocinan y cobran.

### 1.2 Problema que resuelve el sistema

Hoy todo el control es manual (papel y Excel): no hay trazabilidad real del stock, no se sabe exactamente qué se pierde ni por qué, y no hay control financiero de caja. El objetivo del software es **trazabilidad completa desde que entra la materia prima hasta que se cobra al cliente**: todo registrado, todo con responsable, todo comparable contra lo que "debería ser".

### 1.3 Volumen operativo (datos reales validados)

- Facturación semanal: ~$12.848.750 ARS
- ~279 pedidos/semana, ~40 por turno, pico de ~78 órdenes en un turno de domingo
- 5-6 usuarios concurrentes máximo
- 2 turnos/día (día y noche, horarios variables), 1 cajero por sucursal por turno
- Mercado Pago es el medio dominante (~61.5% de ventas), efectivo ~38.5%
- Hasta 10 proveedores, pedidos rutinarios
- **La complejidad está en el dominio de negocio, no en la escala técnica.**

---

## 2. PRINCIPIO DE DISEÑO RECTOR — EL CONTROL CIEGO (INNEGOCIABLE)

> **El empleado que carga un conteo NUNCA ve el valor esperado antes de cargar. El sistema compara internamente y solo informa las discrepancias al Administrador.**

Este principio atraviesa TODO el sistema:

- Arqueo de apertura y cierre de caja: el cajero cuenta el efectivo físico sin saber cuánto debería haber.
- Arqueo de pollos marcados: ídem.
- Recepción de transferencias: el local receptor nunca ve la cantidad enviada por producción.
- Rendimiento esperado de producción: el operario nunca ve cuántas unidades debería haber producido.
- El backend NUNCA devuelve valores esperados, desvíos ni diferencias al rol incorrecto. La defensa es server-side: whitelist explícita en serializers, no blacklist.

**La razón**: si el empleado ve el número esperado, puede acomodar su conteo o su carga para que "cuadre". El control ciego elimina esa posibilidad.

> **Nota de alcance (2026-08-06)**: el Control Ciego también condiciona el diseño de la comandera de MOSTRADOR (ver §5 Flujo 4 y §9): el cajero no ve montos de dinero al cerrar turno, así que ningún ticket impreso en su comandera puede mostrar precios ni totales en pesos.

---

## 3. ROLES Y PERMISOS

| Rol | Quién | Permisos |
|---|---|---|
| **ADMINISTRADOR** | Pablo | Acceso total. CRUD de usuarios, productos, precios, fichas técnicas, stocks mínimos, configuración de comanderas. Recibe TODAS las alertas. Puede desbloquear turnos, generar claves de emergencia, ver reportes financieros completos. Único que "mete mano" en datos. |
| **SOCIO** | Ariel, Eliana, Ema | **Solo lectura**. Ven reportes, informes, historial, auditoría, dashboard. NO pueden modificar ningún dato. Pedido explícito del cliente: "que no rompamos nada sin querer". |
| **ENCARGADO** | A definir | Operativo. Puede operar el POS igual que CAJERO. Puede ver stock de su local. Sin acceso a información financiera ni reportes de rentabilidad. |
| **CAJERO** | Empleados de local | Opera POS, caja, arqueos, gastos, retiros, mermas. No ve montos esperados, diferencias de caja ni datos financieros. Solo ve resumen de ventas por unidad al cerrar turno. |
| **PRODUCCION** | Empleados de producción | Solo módulo de producción: ingresos de mercadería, lotes, transferencias salientes. Interfaz pensada para celular. No ve rendimientos esperados, desvíos ni alertas. |

**Reglas transversales de roles:**

- TODA acción que modifica datos queda asociada al usuario logueado (la "firma digital"). Los usuarios no deben compartirse.
- Cada CAJERO y ENCARGADO tiene `Usuario.sucursalId` asignado. El backend valida siempre contra la DB que el usuario opera en su propia sucursal — nunca confía solo en el JWT.
- Un CAJERO de Local 1 no puede ver ni operar en Local 2. Error 403 si lo intenta.
- PRODUCCION: cero acceso al módulo de ventas y caja.
- SOCIO: cero acceso a endpoints de escritura. Cualquier POST/PUT/PATCH/DELETE devuelve 403.

---

## 4. STACK TECNOLÓGICO (DECIDIDO — NO CAMBIAR)

```
BACKEND
├── Node.js + TypeScript
├── Fastify (framework HTTP)
├── Prisma ORM
├── PostgreSQL 15
├── Socket.io (WebSockets con salas por sucursal)
├── JWT custom + refresh tokens en cookies httpOnly (NO servicios de terceros)
└── Zod para validación de inputs

FRONTEND
├── React 18 + TypeScript
├── Vite (build tool)
├── Tailwind CSS v4
├── React Query
└── PWA (React SPA, NO Next.js — sin SEO necesario)

INFRA
├── Neon (PostgreSQL) — free tier para dev, Launch ~$8-10 USD/mes para prod
├── Railway (backend) — ~$10-20 USD/mes
└── Vercel (frontend estático — tier gratuito suficiente)

HARDWARE — COMANDERAS (decidido 2026-08-06, reemplaza la previsión genérica de Epson TM-T20)
├── Modelo: XPRINTER XP-V320N — térmica 80mm, interfaz USB+LAN, protocolo ESC/POS estándar
│   (mismo protocolo previsto originalmente para la Epson TM-T20 — no cambia el diseño de software,
│   solo el fabricante concreto)
├── Cantidad: 2 comanderas por local de venta → COCINA y MOSTRADOR/CAJA (4 unidades en total: Local 1 y Local 2)
├── Producción NO tiene comandera (no imprime tickets de venta)
├── Conexión: la impresora escucha en el puerto TCP 9100 (raw socket / "JetDirect") de su IP dentro
│   de la LAN del local. El backend abre un socket TCP contra `ip:puerto` y envía directamente el
│   buffer de comandos ESC/POS — sin driver de Windows ni spooler de por medio.
├── IP y puerto de CADA comandera son configurables desde el panel admin (tabla
│   `ConfiguracionComandera`, ver §6), no hardcodeados — permite reasignar la IP si la red del local
│   cambia, sin tocar código.
└── Ver diseño completo del flujo de impresión en §5 (Flujo 4 → "Comanderas") y estado de
    implementación en §9.
```

**Decisiones de arquitectura tomadas (no rediscutir):**

- Web app cloud-hosted + PWA. Descartados: Electron, offline-first, app nativa, Odoo.
- NO offline en v1. Fallback es papel (como operan hoy). Solo banner de "sin conexión" + cache de catálogo vía Service Worker.
- Multi-sucursal desde el día 1: toda tabla relevante tiene `sucursalId`.
- IDs: `Int @default(autoincrement())` en TODO el proyecto. La spec original del módulo 2 mencionaba cuid() — se cambió por consistencia. El módulo 3 y todos los futuros siguen el mismo patrón.
- AFIP/ARCA fuera de v1, pero el modelo de ventas deja campos previstos (`cuit`, `condicionIva`, `nroComprobante` nullable en `Pedido`).

---

## 5. FLUJOS DE NEGOCIO — DETALLE COMPLETO

### FLUJO 1 — Ingreso de Materia Prima

**Actores**: Proveedor (externo) · Usuario PRODUCCION · Sistema
**Cuándo empieza**: llega un proveedor con mercadería.
**Cuándo termina**: el stock de materia prima queda actualizado en producción.

**Pasos y reglas:**

1. El proveedor llega con remito o factura.
2. El Usuario de Producción pesa y cuenta físicamente cada producto. Lo que importa es el **peso real medido**, no lo que dice el remito.
3. Carga el ingreso en el sistema (optimizado para celular):
   - **Proveedor**: de lista precargada (máx ~10). Existe opción **"Otro"** que habilita un campo de comentario libre **obligatorio** cuando se selecciona. Sin comentario → no avanza.
   - **Fecha y hora**: automáticas del servidor. El cliente no puede manipularlas.
   - **Foto del remito**: opcional. Solo respaldo visual, el sistema NO la procesa. Se guarda en storage (S3/Cloudinary — NO disco local de Railway, que es efímero).
   - **Líneas de ingreso**: por cada producto → tipo de materia prima, `cantidadSegunRemito` Y `cantidadRealPesada`. Ambos campos obligatorios. La diferencia queda registrada implícitamente.
4. Validación: proveedor obligatorio, ≥1 línea, cantidades > 0. Sin esto → error, no avanza.
5. **REGLA CRÍTICA**: cada línea queda como **LineaIngreso identificable independiente**. NO se fusiona con otras líneas del mismo producto. Dos líneas del mismo producto en un ingreso = dos LineaIngreso separadas. Esto es la base de la trazabilidad por partida.
6. `cantidadRestanteDisponible` inicial = `cantidadRealPesada` (no el remito).
7. El stock de producción aumenta vía `MovimientoStock` tipo `INGRESO_COMPRA` por `cantidadRealPesada`.
8. Todo en transacción atómica + `RegistroAuditoria` con acción `REGISTRAR_INGRESO_MERCADERIA`.

**TODOS los insumos pasan por este flujo**: carnes, pan rallado, huevos, condimentos, papas, pollos frescos, discos de empanada, etc. Todo producto tiene su stock.

---

### FLUJO 2 — Producción y Conversión

**Actores**: Usuario PRODUCCION · Sistema · ADMINISTRADOR (recibe alertas, no interviene)
**Cuándo empieza**: el usuario de producción quiere transformar materia prima en unidades vendibles.
**Cuándo termina**: las unidades producidas están disponibles en el stock de producción.

**Pasos y reglas:**

1. El usuario elige qué producto elaborado va a producir (ej: milanesa de nalga).
2. **Selección de LineaIngreso de origen**: el sistema muestra las líneas de ingreso disponibles con `cantidadRestanteDisponible > 0` de la materia prima principal. El usuario elige sobre cuál(es) trabaja. La trazabilidad va por partida.
3. El usuario carga **TODOS los insumos que usa**, no solo la carne principal:
   - kg de nalga (referenciando su LineaIngreso)
   - kg de pan rallado (referenciando su LineaIngreso)
   - cantidad de huevos (referenciando su LineaIngreso)
   - condimentos (referenciando sus LineaIngreso)

   Cada insumo referencia su línea de ingreso de origen y se descuenta de su propio stock.
4. **VALIDACIÓN BLOQUEANTE (INNEGOCIABLE)**: si la cantidad de CUALQUIER insumo supera el stock disponible (tanto en `MovimientoStock` agregado como en `cantidadRestanteDisponible` de la línea específica) → error `STOCK_INSUFICIENTE`, el lote NO puede continuar hasta ingresar un valor válido. NUNCA stock negativo. Si falta mercadería, hay que ir al Flujo 1 primero.
5. La **versión activa de la ficha técnica se congela** en el lote al abrirlo (`fichaTecnicaVersionId` queda fijo). Si después se crea una versión nueva de la receta, el lote en curso sigue usando la versión original.
6. **CONTROL CIEGO — INNEGOCIABLE**: el sistema calcula internamente cuántas unidades deberían salir según la ficha técnica, pero este cálculo NO se expone nunca al rol PRODUCCION. Ni en la respuesta de apertura del lote, ni en la de cierre, ni en ningún endpoint. Whitelist explícita en serializers.
7. El usuario produce y cierra el lote cargando:
   - `unidadesProducidasReales`: cuántas unidades salieron
   - `desperdicioRealKg`: cuánto se descartó
8. El sistema calcula el desvío entre esperado y real. Si supera el `umbralDesvioAlertaPct` de la versión de ficha → **Alerta silenciosa solo para ADMINISTRADOR** con: producto, lote, operario, esperado, real, desvío. El operario NUNCA la ve ni sabe que se disparó. El flujo NO se bloquea por desvío.
9. Al cerrar, la transacción es atómica y hace todo esto:
   - Descuenta cada insumo de su stock y de su `cantidadRestanteDisponible` de LineaIngreso (`MovimientoStock CONSUMO_PRODUCCION` por insumo)
   - Suma las unidades producidas al stock de producción (`MovimientoStock PRODUCCION_ALTA`)
   - Registra el desperdicio (`MovimientoStock DESPERDICIO_PRODUCCION`)
   - Calcula y guarda el desvío en el lote
   - Dispara Alerta si corresponde
   - Registra auditoría
   - Si algo falla → rollback completo de todo

**Fichas técnicas y versionado (CRÍTICO):**

- Cada producto elaborado tiene UNA `FichaTecnica` con N `FichaTecnicaVersion`. Solo UNA versión activa a la vez.
- La versión contiene: número, fechaDesde, activa, rendimientoEsperado, desperdicioEsperadoPct, umbralDesvioAlertaPct, y la lista de `IngredienteDeReceta` con `cantidadPorUnidadProducida`.
- **Modificar una receta = crear versión nueva + desactivar la anterior en la misma transacción. NUNCA editar una versión existente.**
- Los lotes históricos apuntan a la versión que estaba vigente cuando se produjeron. Los reportes históricos no se alteran por cambios de receta.
- Constraint en DB: índice único parcial `WHERE activa = true` por ficha — no puede haber dos versiones activas de la misma ficha simultáneamente.

**Recetas reales cargadas en el sistema:**

- Milanesa de nalga: 250g nalga + proporción de pan rallado, huevo, condimentos. Desperdicio 0% (las cantidades ya incluyen el desperdicio — decisión del cliente).
- Empanada de pollo (receta real del cliente, para 72 unidades): 2.5 pollos enteros, 72 discos, 3 kg cebolla, 3 pimientos, 0.25 atado verdeo, 12 huevos.
- Empanada de carne: 1 kg carne molida, 24 tapas, 1 kg tomate, 1 kg cebolla = 24 empanadas.
- Medallón hamburguesa, hamburlomo, bife de lomo, bife de pollo: se producen en producción central (confirmado por Ariel). Fichas técnicas con desperdicio 0%.
- Pollo a la leña (entero): 1 pollo fresco → 1 pollo cocido. Desperdicio 0% (cocinar no reduce unidades).

**Milanesa del sandwich**: la ficha usa 250g de nalga como porción máxima. El cocinero puede usar 1 o 2 milanesas según el peso de cada una para llegar a esa porción. El sistema descuenta la porción (1 unidad), no cuenta milanesas físicas.

---

### FLUJO 3 — Transferencia Interna (Remito Virtual)

**Actores**: Usuario PRODUCCION (emisor) · Usuario del local (receptor) · Sistema · ADMINISTRADOR (alertas)
**Cuándo empieza**: producción tiene unidades listas y las manda a un local.
**Cuándo termina**: el local confirma la recepción y el stock queda actualizado.

**Pasos y reglas:**

**Generación (rol PRODUCCION):**
1. Elige sucursal destino (Local 1 o 2), producto y cantidad en **UNIDADES** (no kilos).
2. El sistema valida stock disponible en producción. Sin stock suficiente → no genera la transferencia.
3. Al confirmar: estado `PENDIENTE_RECEPCION`, stock de producción se descuenta (`MovimientoStock TRANSFERENCIA_SALIDA`), `usuarioEmisor` queda como firma.
4. Transacción atómica: si falla, el stock NO se descuenta.

**Traslado físico** (fuera del sistema).

**Recepción — CONTEO CIEGO (INNEGOCIABLE):**
5. El usuario del local ve la transferencia pendiente: producto y origen. **NUNCA ve la cantidad enviada.** La API no incluye `cantidadEnviada` ni `diferencia` en ninguna respuesta al receptor. Whitelist explícita en serializers.
6. Cuenta físicamente y carga su número.
7. El sistema compara internamente.

**Si coinciden:**
- Estado `CONFIRMADA`, stock del local aumenta (`MovimientoStock TRANSFERENCIA_ENTRADA`), `usuarioReceptor` y `fechaHoraRecepcion` quedan registrados.

**Si NO coinciden:**
- Respuesta al receptor: `{ coincide: false, mensaje: "Los números no coinciden. ¿Recontar o confirmar igual?" }` — sin revelar la diferencia, sin decir cuánto envió producción, sin decir de qué lado está el error.
- El mensaje es idéntico independientemente del tamaño de la diferencia (no da pistas).
- El stock NO se modifica. La transferencia sigue en `PENDIENTE_RECEPCION`.
- El receptor puede recontar (nuevo conteo) sin límite de intentos.

**Confirmar con discrepancia:**
- Estado `CONFIRMADA_CON_DISCREPANCIA`.
- Stock del local aumenta por la **cantidad declarada por el receptor** (NO la enviada por producción).
- **Alerta al ADMINISTRADOR** con: producto, cantidad enviada, cantidad recibida, diferencia, fecha/hora, **usuario emisor Y usuario receptor** (ambas firmas quedan en la alerta).
- El sistema NUNCA se bloquea por discrepancia. La operación continúa.

> **Cambio posterior implementado (commit `4078ee5`)**: el cajero ya NO puede ejecutar "confirmar igual" por su cuenta — la recepción queda trabada, se genera la alerta automática, y **la decisión de con qué cantidad entra la mercadería es del ADMINISTRADOR** desde el panel de Transferencias ("REVISAR Y CERRAR", ver `frontend/src/features/admin/Transferencias.tsx`). El resto de la mecánica ciega no cambia: el cajero sigue sin ver la cantidad enviada.

**Auditoría**: registro en `RegistroAuditoria` al generar y al confirmar. En discrepancia, `datosAnteriores` y `datosNuevos` capturan ambas cantidades y ambos usuarios.

**Retorno a producción (desde locales):**

Cuando un producto retorna de un local a producción (ej: pollo cocido no vendido), el sistema:
- Descuenta del stock del local (`MovimientoStock RETORNO_A_PRODUCCION` negativo)
- Suma al stock de producción (`MovimientoStock RETORNO_A_PRODUCCION` positivo)
- **Crea automáticamente una LineaIngreso sintética** con un `Proveedor` especial del sistema "Retorno interno" (`esProveedorSistema: true`), con comentario `"Retorno desde [nombre del local] — turno [turnoId]"`. Esto garantiza que la cadena de trazabilidad no se rompe y el operario puede usar ese material en un lote de producción seleccionando esa LineaIngreso como origen.
- Todo en la misma transacción atómica.

---

### FLUJO 4 — Venta en el POS

**Actores**: Cliente (externo) · Cajero · Cocina (recibe tickets) · Sistema
**Cuándo empieza**: el cajero abre un nuevo pedido.
**Cuándo termina**: el pedido está cobrado, el stock descontado y cocina tiene su ticket.

#### POS — Reglas de pantalla

- Interfaz táctil con **botones grandes** agrupados por categoría.
- Los productos se ordenan por **más vendidos primero** — calculado automáticamente desde el historial de `ItemDePedido` por sucursal. No es orden manual. Las categorías también se ordenan por popularidad.
- El total del pedido se actualiza en tiempo real a cada cambio.
- El carrito siempre está visible junto a los productos.

#### Catálogo y precios

- **Pollos**: se venden por porción → entero o medio. Son productos distintos en el catálogo.
- **Combos/promos**: precio propio, no calculado. Al vender un combo, el stock se descuenta por cada componente (`ComboComponente`), nunca por el combo en sí (los combos no tienen stock propio).
- **Empanadas**: precio escalonado por volumen (`Precio.cantidad`). Ej: 1 = $X, 6 = $Y, 12 = $Z. El POS calcula el precio óptimo con un algoritmo greedy descendente. El backend es la autoridad del precio al confirmar — el frontend solo hace el cálculo para mostrar el total en vivo.
- Los precios vigentes son legibles por CAJERO y ENCARGADO. El historial de cambios de precio es solo ADMIN y SOCIO.
- El precio se **congela** en `ItemDePedido.precioUnitario` y `ItemDePedido.montoTotal` al confirmar el pedido. Cambios de precio posteriores no alteran pedidos históricos.

#### Tipos de pedido

- **PRESENCIAL**: el cliente está en el local, se cobra en el momento.
- **A_RETIRAR**: pedido por teléfono o WhatsApp. Queda en lista de pendientes. Se cobra cuando el cliente llega.

#### Descuento de stock — CUÁNDO (INNEGOCIABLE)

**El stock se descuenta al CONFIRMAR el pedido (al pasarlo a EN_PREPARACION), NO al cobrar.**

Validado explícitamente con Ariel: *"Si se mandó a preparar, se consumió, se retire o no."* Si el cliente no viene, el stock ya se consumió.

**Excepción única**: si se ANULA un pedido EN_PREPARACION o LISTO, el stock SÍ se repone (`MovimientoStock ANULACION_REPOSICION`).

#### Estados del pedido (INNEGOCIABLE)

```
Cargando ítems (no persistido aún)
       ↓ [cajero confirma]
 EN_PREPARACION
       ↓ [cajero marca listo]
     LISTO
     /    \
[cobrado]   [no viene a buscarlo]
    ↓               ↓
ENTREGADO    LISTO_NO_RETIRADO
                   /    \
          [otro cliente]  [se descarta]
               ↓               ↓
          REASIGNADO          PERDIDO
                          (venta costo cero
                           DESPERDICIO_QUEMADO)

Desde EN_PREPARACION o LISTO:
       ↓ [cajero anula]
    ANULADO → repone TODO el stock
```

**Reglas de transición:**
- Un pedido ENTREGADO jamás se puede anular desde la UI.
- La reasignación NO descuenta stock nuevamente (el stock ya estaba descontado del pedido original).
- PERDIDO no repone stock (el producto se consumió/tiró).
- Un pedido ANULADO guarda en auditoría el pedido COMPLETO tal como estaba (no solo "fue anulado" — todos los ítems y precios quedan en el registro).

#### Cobro

- Se puede pagar con **combinación de medios** en un mismo pedido.
- Medios: EFECTIVO, DEBITO, CREDITO, MERCADO_PAGO, TRANSFERENCIA.
- Vuelto automático solo cuando hay EFECTIVO. `Pago.EFECTIVO` se persiste **neto de vuelto** (lo que quedó físicamente en caja). El bruto queda en `RegistroAuditoria`.
- Si el pago es 100% electrónico con monto mayor al total → error `VUELTO_SIN_EFECTIVO`.
- **Recargo por tarjeta** (commit `a83a182`): selector de porcentaje de recargo aplicable al cobro con tarjeta. Queda reflejado en los reportes de ventas por medio de pago.
- **Descuento a empleado / retiro de socio** (commit `114fd49`): venta a empleado con porcentaje de descuento configurable, y retiro de socio registrado desde el POS.

#### Atenciones / Regalías

- Producto o combo sin cargo.
- Datos obligatorios: producto/combo, cantidad, motivo (lista predefinida + opción "OTRO" con texto libre).
- El stock se descuenta igual que una venta (`MovimientoStock ATENCION`).
- No genera Pago. Queda en historial del turno como egreso de stock.
- El usuario logueado queda como responsable.

#### Venta a costo cero (mermas)

Mecanismo para registrar productos que se consumen sin cobrarlos. Desde la misma pantalla del POS:

- **DESPERDICIO_QUEMADO**: producto destruido, no aprovechable. Stock muere ahí (`MovimientoStock MERMA_QUEMADO`). No mueve caja. Se agrupa en reportes: "esta semana se quemaron X pollos, Y milanesas".
- **RETORNO_A_PRODUCCION**: producto cocido no vendido que vuelve como insumo. Descuenta del local, suma a producción, y **crea LineaIngreso sintética** (ver Flujo 3). No mueve caja.

#### Circuito especial del pollo (INNEGOCIABLE)

El pollo tiene tres estados de stock que los demás productos no tienen:

1. **Pollo fresco/preparado** (en freezer, unidades): llega vía transferencia desde producción. Producto: "Pollo a la leña (entero)".
2. **Pollo marcado** (en la parrilla, disponible para vender): el cajero/parrillero registra cuántos puso a cocinar con `EventoMarcadoPollo`. Descuenta del stock de pollo fresco, suma al stock de "Pollo a la leña (entero) — MARCADO" (`MovimientoStock MARCADO_POLLO`).
3. **Pollo vendido**: la venta de pollo (entero o medio, suelto o en combo) descuenta **del producto MARCADO**, nunca del fresco.

**Destinos del pollo marcado no vendido al cierre del turno:**
- **Sigue apto**: queda en el conteo de marcados, pasa al turno siguiente.
- **Reutilizable** (para empanadas de pollo, tarta, escabeche): registrar como `RETORNO_A_PRODUCCION` → crea LineaIngreso sintética en producción.
- **Quemado/inaprovechable**: registrar como `DESPERDICIO_QUEMADO` → sale del sistema.

**Protección del producto MARCADO**: el producto "Pollo a la leña (entero) — MARCADO" tiene `esProductoSistema: true`. No puede renombrarse ni eliminarse desde el CRUD de catálogo. Si se intenta → error `PRODUCTO_RESERVADO_SISTEMA`.

#### Comanderas (impresoras de cocina y mostrador) — DISEÑO CERRADO 2026-08-06

> Ver hardware elegido en §4, modelo de datos en §6, RBAC en §7 y estado de implementación en §9. Esta subsección describe el **flujo funcional** completo.

**Hardware**: 2 comanderas térmicas XPRINTER XP-V320N por local de venta — una en **COCINA**, una en **MOSTRADOR/CAJA**. Producción no tiene comandera. Cada una tiene su propia IP configurada por el ADMINISTRADOR en el panel (tabla `ConfiguracionComandera`), no hardcodeada.

**Cuándo se imprime** (dispara `TicketCocina` con su `tipo`):
- Al **confirmar** un pedido (pasa a `EN_PREPARACION`) → ticket `NUEVO`.
- Al **modificar** un pedido `EN_PREPARACION` → ticket `ACTUALIZACION` (debe permitir ver qué cambió respecto al ticket anterior, no solo repetir el pedido completo).
- Al **anular** un pedido → ticket `ANULACION`. **Confirmado con el cliente: la anulación SÍ requiere ticket físico** (no alcanza con la alerta visual en el POS) — la cocina tiene que enterarse en papel de que deje de preparar algo cancelado.

**Contenido del ticket** (ambas comanderas reciben el mismo contenido — ver supuesto pendiente de confirmar más abajo):
- **Encabezado**: sucursal, **Nº de pedido** (`Pedido.id`, identificador principal, bien grande), tipo de pedido (PRESENCIAL / A_RETIRAR), fecha y hora.
- **Cuerpo**: cada `ItemDePedido` → cantidad + nombre de producto (los combos se desglosan en sus componentes, nunca "Combo X" sin detalle) + `aclaraciones` resaltadas (ej. "sin sal", "bien cocido"). Las atenciones/regalías se imprimen igual que cualquier ítem — a cocina no le importa si se cobra o no.
- **Pie**: tipo de ticket bien marcado si es `ACTUALIZACION` o `ANULACION` (idealmente con corte y formato distintivo para que no se confunda con un pedido nuevo).
- **Lo que el ticket NUNCA puede incluir**: montos de dinero, precio unitario ni total en pesos. Aplica también al ticket que sale por la comandera de MOSTRADOR — el cajero no ve esos datos por el Control Ciego (§2), así que tampoco pueden aparecer impresos ahí.

**Multi-impresión con tracking individual (server-side, dentro de la transacción de confirmar/modificar/anular):**
1. Se crea/actualiza el `TicketCocina` con su `contenido` (snapshot JSON) y `tipo`.
2. El backend busca las `ConfiguracionComandera` **activas** de la sucursal del pedido (normalmente 2: COCINA y MOSTRADOR).
3. Por cada una, abre un socket TCP a `ip:puerto` (9100 por defecto) y envía el buffer ESC/POS. Se crea un registro `ImpresionComandera` por cada intento, con `impreso` (bool) y `errorImpresion` (si falló).
4. **El pedido se confirma/modifica/anula SIEMPRE**, sin importar si alguna (o las dos) comandera falló — nunca bloquear por hardware.
5. Si alguna comandera no respondió, alerta visual en el POS indicando **cuál** (ej: "No se imprimió en MOSTRADOR — avisar a cocina a viva voz"), para que el cajero sepa exactamente qué faltó, no un error genérico.

**Supuesto tomado, pendiente de confirmar con Ariel/Pablo** (ver §10): se asumió que la comandera de MOSTRADOR imprime una **copia idéntica** del ticket de cocina (mismo contenido, mismas aclaraciones), no un resumen distinto ni un comprobante para el cliente. Si el cliente quiere un formato diferente ahí, hay que rediseñar el contenido — pero en ningún caso ese formato puede incluir montos de dinero.

#### Token de idempotencia

`Pedido.tokenIdempotencia` es un `String @unique` generado en el frontend por cada carrito nuevo. Permite reintentos seguros de `POST /pedidos` sin crear duplicados. Si el backend ya procesó ese token, devuelve el pedido existente.

---

### FLUJO 5 — Caja y Turnos

**Actores**: Cajero · Encargado · Administrador · Sistema
**Cuándo empieza**: el cajero llega a trabajar.
**Cuándo termina**: cierra el turno y la sesión se cierra automáticamente.

#### APERTURA DE TURNO

**Paso 1 — Login**: sin turno abierto para su sucursal, el sistema exige apertura antes de poder vender. No puede hacer nada hasta abrir el turno.

**Paso 2 — Arqueo doble y ciego de apertura (INNEGOCIABLE)**:

El cajero hace DOS conteos sin ver ningún número de referencia:
1. Cuenta el efectivo físico e ingresa el monto.
2. Cuenta los pollos marcados disponibles físicamente e ingresa la cantidad.

La pantalla es completamente neutral: solo campos para ingresar valores. Sin saldos anteriores, sin sugerencias, sin totales visibles.

**Paso 3 — Comparación interna**:

El sistema compara:
- `saldoEsperadoEfectivo` = saldo final de efectivo del turno anterior (o 0 si es el primer turno)
- `pollosMarcadosEsperados` = conteo final de pollos marcados del turno anterior (o 0)

El cálculo del faltante o sobrante lo hace **automáticamente el sistema**, no lo carga el cajero a mano.

**Si coinciden ambos** → turno ABIERTO.

**Si alguno no coincide** → turno BLOQUEADO.
- El cajero ve mensaje genérico: *"Hay una diferencia en el conteo. Se notificó al administrador. Esperá la autorización para continuar."*
- NO se muestra: de cuánto es la diferencia, si es faltante o sobrante, cuál de los dos arqueos falló, nada financiero.
- Notificación push (WebSocket) **solo al ADMINISTRADOR** con: monto esperado, monto contado, diferencia, local, cajero del cierre anterior + cajero que está abriendo.

**Paso 4 — Desbloqueo (dos caminos)**:

**Camino A — Remoto** (el admin tiene acceso):
El admin ve la notificación en su panel con todos los datos, aprieta "Desbloquear". El turno pasa a ABIERTO. Queda registrado: quién autorizó, cuándo, con qué diferencia había, cajero anterior y cajero actual.

**Camino B — Clave de emergencia** (el admin no tiene acceso en ese momento):
- En la pantalla de bloqueo hay una opción **discreta, no obvia** (pequeña, en un rincón) para ingresar una clave.
- El admin genera la clave desde su panel: es aleatoria (8 caracteres sin ambiguos), de **un solo uso**, expira a los **10 minutos**, generar una nueva invalida la anterior.
- El admin la dicta al cajero por teléfono.
- El cajero la ingresa y el turno se desbloquea.
- La clave puede servir para cualquier turno bloqueado de cualquier sucursal (comportamiento intencional para cuando el admin no tiene acceso al panel).
- Todo el evento queda registrado: quién generó la clave, quién la usó, con qué diferencia había, hora exacta.
- Error genérico `CLAVE_INVALIDA` para todo fallo (expirada, ya usada, incorrecta) — sin revelar el motivo específico.

#### GESTIÓN DEL TURNO

El cajero puede hacer:
- Vender (Flujo 4)
- **Marcar pollos** (`EventoMarcadoPollo`): "tiré X pollos a la parrilla". Descuenta de pollo fresco, suma a pollo marcado, dentro de la misma transacción atómica. Puede hacerse múltiples veces en el turno.
- **Gastos de caja**: monto + medio (solo EFECTIVO o MERCADO_PAGO para gastos) + categoría de lista u "OTRO" con texto libre obligatorio. Queda con el usuario cajero y la hora.
- **Retiros parciales**: monto + medio + quién de los socios retiró. **Selector CERRADO** con exactamente 3 opciones: `ARIEL`, `ELIANA`, `EMA`. No es texto libre. No hay cuarta opción.

#### CIERRE DE TURNO

**Paso 1**: el cajero selecciona "Cerrar turno".

**Paso 2 — Arqueo doble y ciego de cierre**:
Igual que en apertura: el cajero cuenta el efectivo e ingresa el monto, cuenta los pollos marcados e ingresa la cantidad. Sin ver ningún número de referencia.

**El cierre NUNCA bloquea**, aunque haya discrepancia. La diferencia queda registrada en el `Arqueo` de cierre y en el resumen del turno para el admin — pero el cajero puede cerrar igual.

**Paso 3 — El sistema cruza todo internamente**:

```
Saldo final esperado efectivo =
  valor_contado_apertura
  + SUM(Pago.EFECTIVO) [pagos netos de ventas]
  - SUM(GastoDeCaja.monto WHERE medio=EFECTIVO)
  - SUM(RetiroDeCaja.monto WHERE medio=EFECTIVO)

Pollos marcados esperados al cierre =
  valor_contado_apertura_pollos
  + SUM(EventoMarcadoPollo.cantidad)
  - SUM(ventas de pollo entero)
  - SUM(ventas de medio pollo × 0.5)
  - pollos retornados
  - pollos desperdiciados
```

**Paso 4 — Lo que ve cada rol**:

**El CAJERO VE** (y SOLO esto):
- Resumen de ventas **por unidad, sin montos de dinero**: cuántos pollos enteros, cuántos medios, cuántas milanesas, etc.
- Conteo final de pollos marcados (saldo que pasa al turno siguiente).
- Mensaje de confirmación de cierre.

**El CAJERO NO VE NUNCA**: el total vendido en pesos, la diferencia de caja, el faltante o sobrante, los montos de retiros ni de gastos, ningún dato financiero.

**El ADMINISTRADOR y los SOCIOS VEN** (en sus reportes):
- Resumen financiero completo: ventas por medio, gastos, retiros por socio, atenciones, mermas, diferencia de caja.

**Paso 5**: turno queda CERRADO. Sesión del cajero se cierra automáticamente. Los saldos finales (efectivo y pollos marcados) quedan como referencia para el arqueo de apertura del turno siguiente.

---

### FLUJO 6 — Alertas de Stock Mínimo

**Actores**: Sistema (automático) · Cajero (ve alertas en POS) · Administrador (recibe notificación)
**Cuándo se dispara**: automáticamente en cada movimiento que reduce stock de un producto.

**Reglas:**

- **Configuración**: `ConfiguracionStockMinimo` por producto y por sucursal. Solo ADMINISTRADOR puede configurar. Si un producto no tiene mínimo configurado, no genera alertas.
- **Alerta repetida bajo el mínimo**: cada venta que deja el stock bajo el mínimo → pop-up en el POS. Se repite en CADA venta siguiente mientras siga bajo el mínimo. No bloquea mientras haya stock > 0. Pedido explícito del cliente: *"que le seque la cabeza al cajero"*.
- **Bloqueo real en CERO**: si el stock de un producto es exactamente 0, el sistema **NO permite venderlo**. El POS lo muestra bloqueado. No es una alerta — es un bloqueo real.
- **Notificación al ADMINISTRADOR**: cuando el stock cruza el umbral mínimo (solo al cruzarlo, no en cada venta posterior). La alerta se genera dentro de la misma transacción del movimiento de stock.
- **Desactivación automática**: cuando el stock vuelve a superar el mínimo (por transferencia recibida), la alerta se apaga sola.
- **Stock mínimo con combos**: la evaluación verifica los componentes del combo, no el combo en sí (los combos no tienen stock propio).

---

### FLUJO 7 — Auditoría y Trazabilidad

**Actores**: Sistema (registra todo automáticamente) · Administrador y Socios (consultan)
**Principio**: corre en paralelo con todos los flujos, siempre. Sin acción del usuario. Sin posibilidad de editar ni borrar registros.

**Acciones que generan RegistroAuditoria:**

*Producción*: `REGISTRAR_INGRESO_MERCADERIA`, `ABRIR_LOTE_PRODUCCION`, `CERRAR_LOTE_PRODUCCION`, `CREAR_VERSION_FICHA_TECNICA`, `GENERAR_TRANSFERENCIA`, `CONFIRMAR_TRANSFERENCIA`, `CONFIRMAR_TRANSFERENCIA_CON_DISCREPANCIA`, `REGISTRAR_RETORNO_PRODUCCION`

*Ventas*: `CONFIRMAR_PEDIDO` (con snapshot completo), `MODIFICAR_PEDIDO` (con estado anterior + nuevo), `ANULAR_PEDIDO` (con pedido COMPLETO tal como estaba — todos los ítems y precios), `COBRAR_PEDIDO`, `REGISTRAR_ATENCION`, `VENTA_COSTO_CERO`

*Caja*: `ABRIR_TURNO`, `CERRAR_TURNO`, `BLOQUEO_TURNO` (cajero anterior + cajero actual + diferencias), `DESBLOQUEO_TURNO_REMOTO`, `DESBLOQUEO_TURNO_CLAVE`, `GENERAR_CLAVE_EMERGENCIA`, `REGISTRAR_GASTO_CAJA`, `REGISTRAR_RETIRO_CAJA` (con cuál socio retiró), `MARCAR_POLLOS`

*Administración*: `CREAR_USUARIO`, `MODIFICAR_USUARIO`, `CAMBIO_PRECIO` (precio anterior + nuevo + quién + cuándo), `CREAR_VERSION_FICHA_TECNICA`, `MODIFICAR_STOCK_MINIMO`, `MODIFICAR_CONFIGURACION_COMANDERA` (IP/puerto anterior + nuevo + quién + cuándo)

**Cada registro contiene siempre**: accion, entidad, entidadId, usuarioId, fechaHora (UTC), datosAnteriores (JSON), datosNuevos (JSON).

**Consulta**: Admin y Socios con filtros por fecha, usuario, tipo de acción, módulo, sucursal. Historial permanente sin límite de tiempo.

**La cadena de trazabilidad completa** (el corazón del sistema):

```
Proveedor → IngresoMercaderia → LineaIngreso → InsumoUsado
         → LoteDeProduccion → MovimientoStock (PRODUCCION_ALTA)
         → Transferencia → LineaDeTransferencia
         → MovimientoStock (TRANSFERENCIA_ENTRADA) en el local
         → ItemDePedido → Pedido → cliente
```

Debe poder responderse: *"esta milanesa vendida el viernes salió de la entrega de nalga del proveedor X del 3/7, producida por el operario Y en el lote Z con la versión 2 de la receta."*

> **Implementado** (commits `f418bfd` y `d1e51cb`): `GET /api/reportes/trazabilidad/pedido/:id` (ADMIN+SOCIO) reconstruye la cadena para cada ítem del pedido, y el envío de transferencias permite **elegir explícitamente de qué partida sale cada producto**, cerrando el último eslabón que antes se inferría por fecha.

---

## 6. MODELO DE DATOS — SCHEMA COMPLETO

### Convenciones del schema

- IDs: `Int @default(autoincrement())` en TODOS los modelos.
- Fechas: UTC en DB, zona `America/Argentina/Cordoba` en presentación.
- Moneda: `Decimal` (nunca `Float`).
- Código, comentarios y nombres de dominio: en español.

> **Nota importante**: el fragmento de schema de esta sección es una **guía de referencia**, no el archivo fuente. La fuente de verdad es siempre `prisma/schema.prisma`. Si hay diferencia, gana el schema real.

### Entidades transversales

```prisma
model Sucursal {
  id        Int     @id @default(autoincrement())
  nombre    String
  tipo      TipoSucursal // PRODUCCION | VENTA
  direccion String?
  activa    Boolean @default(true)
}

model Usuario {
  id           Int     @id @default(autoincrement())
  nombre       String
  username     String  @unique
  passwordHash String
  rol          Rol     // ADMINISTRADOR | SOCIO | ENCARGADO | CAJERO | PRODUCCION
  sucursalId   Int?    // Obligatorio para CAJERO y ENCARGADO
  activo       Boolean @default(true)
}

model Producto {
  id                Int          @id @default(autoincrement())
  nombre            String       @unique
  categoria         String
  tipo              TipoProducto // MATERIA_PRIMA | ELABORADO | REVENTA | COMBO
  unidadDeMedida    UnidadMedida // KG | UNIDAD
  activo            Boolean      @default(true)
  esProductoSistema Boolean      @default(false) // Si true: no se puede renombrar ni eliminar
}

model Precio {
  id         Int      @id @default(autoincrement())
  productoId Int
  monto      Decimal
  cantidad   Int      @default(1) // Para tablas de precio por volumen (ej: empanadas)
  fechaDesde DateTime @default(now())
  usuarioId  Int
  // Nunca se edita: cambio de precio = registro nuevo
}

// CORREGIDO 2026-08-06 (contrastado contra prisma/schema.prisma):
// NO existe un `model Combo` propio con `precioCombo`. Un combo es un
// `Producto` con `tipo: COMBO`, y su precio vive en `Precio` como el de
// cualquier otro producto (incluida la tabla por volumen). `ComboComponente`
// solo define DE QUÉ se arma. Esta decisión ya estaba tomada en el Módulo 1 y
// es la que el código implementa — un `model Combo` separado rompería el POS.
model ComboComponente {
  id                   Int      @id @default(autoincrement())
  comboId              Int      // FK a Producto (el que tiene tipo = COMBO)
  productoComponenteId Int      // FK a Producto (nunca otro COMBO — sin anidar)
  cantidad             Decimal
  @@unique([comboId, productoComponenteId])
}

model MovimientoStock {
  id          Int                @id @default(autoincrement())
  productoId  Int
  sucursalId  Int
  tipo        TipoMovimiento
  cantidad    Decimal            // Positivo = entra, Negativo = sale
  fechaHora   DateTime           @default(now())
  usuarioId   Int
  tipoOrigen  String?            // Referencia polimórfica al documento origen
  origenId    Int?
}
// Stock actual = SUM(MovimientoStock.cantidad) por producto+sucursal
// Puede materializarse en tabla StockActual por performance, pero la fuente de verdad son los movimientos

model RegistroAuditoria {
  id              Int      @id @default(autoincrement())
  accion          String
  entidad         String
  entidadId       Int?
  usuarioId       Int
  fechaHora       DateTime @default(now())
  datosAnteriores Json?
  datosNuevos     Json?
  // Inmutable: sin UPDATE ni DELETE permitidos en la capa de servicio
}

model Alerta {
  id          Int       @id @default(autoincrement())
  tipo        TipoAlerta // DESVIO_PRODUCCION | DISCREPANCIA_TRANSFERENCIA | DISCREPANCIA_CAJA | BLOQUEO_TURNO | STOCK_MINIMO
  tipoOrigen  String
  origenId    Int
  fechaHora   DateTime  @default(now())
  vista       Boolean   @default(false)
  detalle     Json      // Snapshot de los datos relevantes del evento
  // Solo visible para ADMINISTRADOR
}
```

### Módulo 1 — Producción y Stock

```prisma
model Proveedor {
  id                 Int     @id @default(autoincrement())
  nombre             String
  contacto           String?
  activo             Boolean @default(true)
  esOtro             Boolean @default(false) // El proveedor genérico "Otro"
  esProveedorSistema Boolean @default(false) // Si true: no se puede renombrar ni eliminar
}

model IngresoMercaderia {
  id                       Int      @id @default(autoincrement())
  proveedorId              Int
  comentarioProveedorOtro  String?  // Obligatorio si proveedor.esOtro = true
  sucursalId               Int      // Siempre = sucursal Producción
  fechaHora                DateTime @default(now())
  usuarioId                Int
  fotoRemitoUrl            String?  // Storage persistente (S3/Cloudinary, NO disco local)
  lineas                   LineaIngreso[]
}

model LineaIngreso {
  id                       Int     @id @default(autoincrement())
  ingresoMercaderiaId      Int
  productoId               Int
  cantidadSegunRemito      Decimal
  cantidadRealPesada       Decimal
  cantidadRestanteDisponible Decimal // Se va consumiendo a medida que producción la usa
}

model FichaTecnica {
  id                 Int                  @id @default(autoincrement())
  productoElaboradoId Int                 @unique // 1 a 1 con Producto tipo ELABORADO
  versiones          FichaTecnicaVersion[]
}

model FichaTecnicaVersion {
  id                   Int                  @id @default(autoincrement())
  fichaTecnicaId       Int
  numeroVersion        Int
  fechaDesde           DateTime             @default(now())
  activa               Boolean              @default(true)
  rendimientoEsperado  Decimal
  desperdicioEsperadoPct Decimal            @default(0)
  umbralDesvioAlertaPct  Decimal
  ingredientes         IngredienteDeReceta[]
  // Constraint: solo una versión activa por ficha
}

model IngredienteDeReceta {
  id                     Int     @id @default(autoincrement())
  fichaTecnicaVersionId  Int
  productoInsumoId       Int
  cantidadPorUnidadProducida Decimal
  esPrincipal            Boolean @default(false) // Insumo base para calcular el rendimiento esperado
}

model LoteDeProduccion {
  id                    Int              @id @default(autoincrement())
  productoElaboradoId   Int
  fichaTecnicaVersionId Int              // Congelada al abrir el lote
  fechaHora             DateTime         @default(now())
  usuarioOperarioId     Int
  unidadesProducidasReales Decimal?
  desperdicioRealKg     Decimal?
  unidadesEsperadas     Decimal?         // NUNCA expuesto al rol PRODUCCION
  desvioPct             Decimal?         // NUNCA expuesto al rol PRODUCCION
  alertaDisparada       Boolean          @default(false) // NUNCA expuesto al rol PRODUCCION
  estado                EstadoLote       @default(ABIERTO) // ABIERTO | CERRADO
  insumosUsados         InsumoUsado[]
}

model InsumoUsado {
  id                Int     @id @default(autoincrement())
  loteDeProduccionId Int
  productoInsumoId  Int
  lineaIngresoOrigenId Int  // La partida específica de origen
  cantidadUsada     Decimal
}

model Transferencia {
  id                 Int                    @id @default(autoincrement())
  sucursalOrigenId   Int
  sucursalDestinoId  Int
  fechaHoraEnvio     DateTime               @default(now())
  usuarioEmisorId    Int
  usuarioReceptorId  Int?
  fechaHoraRecepcion DateTime?
  estado             EstadoTransferencia    @default(PENDIENTE_RECEPCION)
  lineas             LineaDeTransferencia[]
}

model LineaDeTransferencia {
  id              Int     @id @default(autoincrement())
  transferenciaId Int
  productoId      Int
  cantidadEnviada Decimal // NUNCA visible para el receptor — whitelist en serializers
  cantidadRecibida Decimal?
  diferencia      Decimal? // Calculada al confirmar — NUNCA visible para el receptor
}
```

### Módulo 2 — POS y Caja

```prisma
// CORREGIDO 2026-08-06: `Turno.id` es Int autoincrement, igual que el resto del
// proyecto. El doc anterior lo daba como String/cuid "a verificar" — verificado
// contra prisma/schema.prisma: es Int. No hay inconsistencia de IDs en el schema.
model Turno {
  id                Int         @id @default(autoincrement())
  sucursalId        Int
  usuarioCajeroId   Int
  fechaApertura     DateTime    @default(now())
  fechaCierre       DateTime?
  estado            EstadoTurno @default(ABIERTO) // ABIERTO | BLOQUEADO | CERRADO
  arqueos           Arqueo[]
  pedidos           Pedido[]
  gastos            GastoDeCaja[]
  retiros           RetiroDeCaja[]
  bloqueo           BloqueoDeTurno?
}

model Arqueo {
  id            Int             @id @default(autoincrement())
  turnoId       Int
  momento       MomentoArqueo   // APERTURA | CIERRE
  tipo          TipoArqueo      // EFECTIVO | POLLOS_MARCADOS
  valorContado  Decimal         // Lo que declaró el cajero
  valorEsperado Decimal         // Calculado por el sistema — NUNCA expuesto al cajero
  diferencia    Decimal         // valorContado - valorEsperado
  resultado     ResultadoArqueo // COINCIDE | FALTANTE | SOBRANTE
  fechaHora     DateTime        @default(now())
}

model BloqueoDeTurno {
  id                    Int            @id @default(autoincrement())
  turnoId               Int            @unique
  usuarioCajeroActual   Int
  usuarioCajeroAnterior Int?
  estado                EstadoBloqueo  @default(BLOQUEADO)
  tipoDesbloqueo        TipoDesbloqueo?
  usuarioAutorizanteId  Int?
  fechaDesbloqueo       DateTime?
  claveEmergenciaId     Int?
}

model ClaveDeEmergencia {
  id          Int      @id @default(autoincrement())
  codigo      String   @unique // 8 chars aleatorios sin ambiguos
  generadaPor Int
  turnoId     Int?     // Puede ser null (sirve para cualquier turno bloqueado)
  expiraEn    DateTime // now() + 10 minutos
  usada       Boolean  @default(false)
  usadaEn     DateTime?
}

model Pedido {
  id                  Int          @id @default(autoincrement())
  turnoId             Int
  sucursalId          Int
  tipo                TipoPedido   // PRESENCIAL | A_RETIRAR
  estado              EstadoPedido @default(EN_PREPARACION)
  usuarioCajeroId     Int
  tokenIdempotencia   String?      @unique // UUID generado en frontend, evita duplicados
  pedidoOrigenId      Int?         // Si fue reasignado desde otro pedido
  fechaCreacion       DateTime     @default(now())
  fechaCierre         DateTime?
  // Timer de pedido no retirado
  fechaListoNoRetirado   DateTime?
  avisoNoRetiradoEmitido Boolean   @default(false)
  // Campos para AFIP futuro (no implementar, solo dejar previstos):
  cuit                String?
  condicionIva        String?
  nroComprobante      String?
  canalOrigen         String       @default("MOSTRADOR") // MOSTRADOR | TELEFONO | WHATSAPP (futuro)
  items               ItemDePedido[]
  pagos               Pago[]
  tickets             TicketCocina[]
}

// CORREGIDO 2026-08-06: NO hay `comboId`. Un combo se vende como cualquier
// producto (`productoId` apunta al Producto tipo COMBO) y al confirmar el
// backend recorre `ComboComponente` para descontar cada componente.
model ItemDePedido {
  id               Int             @id @default(autoincrement())
  pedidoId         Int
  productoId       Int             // Cubre productos normales Y combos
  cantidad         Decimal
  montoTotal       Decimal         // Total de línea CONGELADO (fuente de verdad del cobro)
  precioUnitario   Decimal         // Referencia: montoTotal / cantidad
  aclaraciones     String?
  esVentaCostoCero Boolean         @default(false)
  tipoCostoCero    TipoCostoCero?  // DESPERDICIO_QUEMADO | RETORNO_A_PRODUCCION
}

model Pago {
  id        Int       @id @default(autoincrement())
  pedidoId  Int
  medio     MedioPago // EFECTIVO | DEBITO | CREDITO | MERCADO_PAGO | TRANSFERENCIA
  monto     Decimal   // NETO de vuelto para EFECTIVO
  fechaHora DateTime  @default(now())
}

// CORREGIDO 2026-08-06: sin `comboId`, misma razón que ItemDePedido.
model Atencion {
  id             Int      @id @default(autoincrement())
  turnoId        Int
  sucursalId     Int
  productoId     Int
  cantidad       Decimal
  motivoCodigo   String   // De lista predefinida o "OTRO"
  motivoDetalle  String?  // Obligatorio si motivoCodigo = "OTRO"
  usuarioId      Int
  fechaHora      DateTime @default(now())
}

model GastoDeCaja {
  id          Int       @id @default(autoincrement())
  turnoId     Int
  monto       Decimal
  medio       MedioPago // Solo EFECTIVO o MERCADO_PAGO
  categoria   String    // Lista predefinida o "OTRO"
  descripcion String?   // Obligatorio si categoria = "OTRO"
  usuarioId   Int
  fechaHora   DateTime  @default(now())
}

model RetiroDeCaja {
  id              Int         @id @default(autoincrement())
  turnoId         Int
  monto           Decimal
  medio           MedioPago
  socio           SocioRetiro // ARIEL | ELIANA | EMA — selector CERRADO, no texto libre
  usuarioCajeroId Int
  fechaHora       DateTime    @default(now())
}

model EventoMarcadoPollo {
  id         Int      @id @default(autoincrement())
  turnoId    Int
  sucursalId Int
  cantidad   Decimal
  usuarioId  Int
  fechaHora  DateTime @default(now())
}

// ── COMANDERAS ── ✔ implementado y migrado el 2026-08-06
// (migración 20260806120000_comanderas_por_destino)

model TicketCocina {
  id             Int        @id @default(autoincrement())
  pedidoId       Int
  tipo           TipoTicket // NUEVO | ACTUALIZACION | ANULACION
  contenido      Json       // Snapshot de los items al momento de imprimir. NUNCA incluye montos de dinero.
  fechaHora      DateTime   @default(now())
  impresiones    ImpresionComandera[] // Un intento por cada ConfiguracionComandera activa de la sucursal
  // impreso/errorImpresion se movieron a ImpresionComandera: con una comandera
  // de COCINA y otra de MOSTRADOR por local, un solo par de columnas no
  // alcanzaba para saber cuál de las dos falló.
}

model ConfiguracionComandera {
  id         Int              @id @default(autoincrement())
  sucursalId Int
  destino    DestinoComandera // COCINA | MOSTRADOR
  nombre     String           // Ej: "Comandera cocina - Local 1". Solo identificación en el panel admin.
  ip         String
  puerto     Int              @default(9100) // Puerto TCP raw/ESC-POS estándar de la impresora de red
  activa     Boolean          @default(true)
  // Solo ADMINISTRADOR puede configurar (crear/editar/desactivar). Producción no tiene comandera.
  @@unique([sucursalId, destino])
}

model ImpresionComandera {
  id                       Int      @id @default(autoincrement())
  ticketCocinaId           Int
  configuracionComanderaId Int
  impreso                  Boolean  @default(false)
  errorImpresion           String?  // Mensaje de error si falló (timeout, IP inaccesible, etc.)
  fechaHoraIntento         DateTime @default(now())
  // Un TicketCocina genera un registro por cada ConfiguracionComandera activa de la sucursal
  // del pedido (normalmente 2). Permite saber con precisión cuál impresora falló sin perder
  // el resultado de la que sí funcionó. Nunca bloquea el pedido si falla (ver Flujo 4).
}

model ConfiguracionStockMinimo {
  id         Int     @id @default(autoincrement())
  productoId Int
  sucursalId Int
  minimo     Decimal
  activa     Boolean @default(true)
  @@unique([productoId, sucursalId])
}
```

### Enums relevantes

```prisma
enum Rol { ADMINISTRADOR SOCIO ENCARGADO CAJERO PRODUCCION }
enum TipoSucursal { PRODUCCION VENTA }
enum TipoProducto { MATERIA_PRIMA ELABORADO REVENTA COMBO }
enum UnidadMedida { KG UNIDAD }
enum TipoMovimiento {
  INGRESO_COMPRA CONSUMO_PRODUCCION PRODUCCION_ALTA DESPERDICIO_PRODUCCION
  TRANSFERENCIA_SALIDA TRANSFERENCIA_ENTRADA VENTA ANULACION_REPOSICION
  ATENCION MERMA_QUEMADO RETORNO_A_PRODUCCION MARCADO_POLLO AJUSTE
}
enum TipoAlerta { DESVIO_PRODUCCION DISCREPANCIA_TRANSFERENCIA DISCREPANCIA_CAJA BLOQUEO_TURNO STOCK_MINIMO }
enum EstadoLote { ABIERTO CERRADO }
enum EstadoTransferencia { PENDIENTE_RECEPCION CONFIRMADA CONFIRMADA_CON_DISCREPANCIA }
enum EstadoTurno { ABIERTO BLOQUEADO CERRADO }
enum MomentoArqueo { APERTURA CIERRE }
enum TipoArqueo { EFECTIVO POLLOS_MARCADOS }
enum ResultadoArqueo { COINCIDE FALTANTE SOBRANTE }
enum EstadoBloqueo { BLOQUEADO DESBLOQUEADO }
enum TipoDesbloqueo { REMOTO CLAVE_EMERGENCIA }
enum TipoPedido { PRESENCIAL A_RETIRAR }
enum EstadoPedido { EN_PREPARACION LISTO ENTREGADO LISTO_NO_RETIRADO REASIGNADO PERDIDO ANULADO }
enum MedioPago { EFECTIVO DEBITO CREDITO MERCADO_PAGO TRANSFERENCIA }
enum TipoCostoCero { DESPERDICIO_QUEMADO RETORNO_A_PRODUCCION }
enum SocioRetiro { ARIEL ELIANA EMA }
enum TipoTicket { NUEVO ACTUALIZACION ANULACION }
enum DestinoComandera { COCINA MOSTRADOR } // Agregado 2026-08-06 — pendiente de migrar
```

---

## 7. RBAC — TABLA COMPLETA DE PERMISOS POR ENDPOINT

| Endpoint | ADMIN | SOCIO | ENCARGADO | CAJERO | PRODUCCION |
|---|---|---|---|---|---|
| **AUTH** |||||
| `POST /auth/login` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /auth/refresh` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /auth/logout` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **USUARIOS** |||||
| `GET/POST/PUT/DELETE /usuarios` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **PRODUCTOS Y CATÁLOGO** |||||
| `GET /productos` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST/PUT/DELETE /productos` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /productos/precios-vigentes` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /precios` (historial) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /precios` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET/POST/PUT/DELETE /productos/combos` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **FICHAS TÉCNICAS** |||||
| `GET /fichas-tecnicas` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /fichas-tecnicas` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **PROVEEDORES** |||||
| `GET /proveedores` | ✅ | ✅ | ❌ | ❌ | ✅ |
| `POST/PUT/DELETE /proveedores` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **INGRESOS DE MERCADERÍA** |||||
| `POST /ingresos` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `GET /ingresos` | ✅ | ✅ | ❌ | ❌ | ✅ |
| **PRODUCCIÓN** |||||
| `POST /produccion/lotes` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `PATCH /produccion/lotes/:id/cerrar` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `GET /produccion/lotes` | ✅ | ✅ | ❌ | ❌ | ✅ |
| **TRANSFERENCIAS** |||||
| `POST /transferencias` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `POST /transferencias/:id/recepcionar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /transferencias/:id/confirmar-discrepancia` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /transferencias` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **STOCK** |||||
| `GET /stock` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /stock/movimientos` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **TURNOS Y CAJA** |||||
| `POST /turnos/abrir` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /turnos/cerrar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /turnos/activo` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /turnos` (historial) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /turnos/:id/resumen` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /turnos/:id/desbloquear` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /claves-emergencia` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /claves-emergencia/usar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| **PEDIDOS** |||||
| `POST /pedidos` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `PATCH /pedidos/:id` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/cobrar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/anular` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/marcar-listo` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/no-retirado` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/reasignar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /pedidos/:id/marcar-perdido` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /pedidos/pendientes` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /pedidos/mas-vendidos` | ✅ | ❌ | ✅ | ✅ | ❌ |
| **CAJA — OPERACIONES** |||||
| `POST /atenciones` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /gastos-caja` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /retiros-caja` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /marcado-pollos` | ✅ | ❌ | ✅ | ✅ | ❌ |
| **COMANDERAS (IMPRESORAS DE COCINA/MOSTRADOR)** |||||
| `GET /configuracion-comandera` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST/PATCH/DELETE /configuracion-comandera` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /configuracion-comandera/:id/probar` (ticket de prueba) | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /configuracion-comandera/tickets/:pedidoId` (soporte) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **ALERTAS** |||||
| `GET /alertas` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PATCH /alertas/:id/vista` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **STOCK MÍNIMO** |||||
| `GET /stock-minimo` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `POST/PATCH/DELETE /stock-minimo` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **AUDITORÍA** |||||
| `GET /auditoria` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **REPORTES Y DASHBOARD (módulo 3)** |||||
| `GET /api/dashboard` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /api/reportes/*` | ✅ | ✅ | ❌ | ❌ | ❌ |

**Regla de sucursal para roles operativos**: CAJERO y ENCARGADO solo pueden operar en su `Usuario.sucursalId`. El backend valida contra la DB, nunca confía solo en el JWT. Error 403 si intenta operar en otra sucursal.

**Nota sobre comanderas**: la configuración de IP/puerto es exclusivamente de ADMINISTRADOR — es infraestructura, no un dato de negocio que necesiten ver Socios. CAJERO/ENCARGADO/PRODUCCION solo interactúan con el resultado (alerta visual en el POS si falló una impresión), nunca con la configuración.

---

## 8. WEBSOCKETS — EVENTOS EN TIEMPO REAL

Socket.io con **salas por sucursal**. Cada cliente se une a la sala de su sucursal al conectarse.

| Evento | Quién emite | Sala / quién recibe | Cuándo |
|---|---|---|---|
| `alerta:nueva` | Backend | Admin | Cualquier alerta nueva |
| `alerta:stock_minimo` | Backend | Sala del local + Admin | Cuando el stock cruza el mínimo |
| `ticket:nuevo` | Backend | Cocina del local | Al confirmar pedido |
| `ticket:actualizacion` | Backend | Cocina | Al modificar pedido |
| `ticket:anulacion` | Backend | Cocina | Al anular pedido |
| `turno:bloqueado` | Backend | Admin | Al detectar discrepancia en apertura |
| `turno:desbloqueado` | Backend | POS del cajero bloqueado | Admin/clave desbloquea |
| `pedido:listo_no_retirado` | Backend (timer) | Admin | Pedido pendiente > N minutos |

Polling de 20 segundos como respaldo para `turno:desbloqueado`.

> **Nota (2026-08-06)**: `ticket:nuevo` / `ticket:actualizacion` / `ticket:anulacion` deberán disparar internamente el intento de impresión física en **ambas** comanderas de la sucursal (COCINA y MOSTRADOR, ver §5 Flujo 4 y §6 `ImpresionComandera`), no solo el mock de consola. El evento de WebSocket sigue siendo el mismo; lo que cambia es qué hace el listener del backend al recibirlo (hoy es un `console.log`, debe pasar a ser un intento real de socket TCP por cada comandera activa).

---

## 9. ESTADO ACTUAL DEL PROYECTO

> **Verificado contra el código el 2026-08-06** (rama `feature/modulo-2`, commit `9e67f86`).

### Módulo 1 — Producción + Stock + Transferencias ✅ COMPLETO
- Backend + Frontend implementados y auditados
- En rama `main` (y en `feature/modulo-2` con mejoras posteriores)
- Incluye: ingresos de mercadería, lotes de producción con comparador ciego, fichas técnicas versionadas, transferencias con doble confirmación ciega, stock multi-sucursal, auditoría inmutable

### Módulo 2 — POS + Caja y Turnos ✅ COMPLETO (con salvedad de hardware)
- Backend + Frontend implementados y auditados
- En rama `feature/modulo-2` — pendiente de merge a `main`
- Incluye: POS táctil ordenado por más vendidos, circuito del pollo marcado, todos los estados del pedido, cobro combinado, arqueo doble ciego, bloqueo/desbloqueo, clave de emergencia, gastos y retiros por socio, stock mínimo por transacción, WebSockets por sala de sucursal, idempotencia y guard atómico contra carreras
- **Salvedad**: "comandera" en este alcance se refiere al *flujo lógico* (generar `TicketCocina`, emitir el evento WebSocket, no bloquear por hardware). La *conexión física real* a la impresora está diseñada (ver más abajo) pero **no implementada** — `src/modules/pedidos/comandera.ts` sigue siendo un mock que loguea en consola.

### Módulo 3 — Reportes + Dashboard ✅ COMPLETO
- Backend + Frontend implementados
- En rama `feature/modulo-2`
- **No se necesitó migración de Prisma**: todos los datos que consumen los reportes ya existían en el schema de los módulos anteriores
- **✔ Tests de integración: SÍ existen** (CORREGIDO 2026-08-06 — el doc anterior los daba por pendientes): `tests/integration/reportes.test.ts` y `tests/integration/dashboard.test.ts`

#### Backend del módulo 3
**`src/modules/reportes/reportes.service.ts`** — 8 funciones de reporte + trazabilidad:
- `ventasPorProducto`, `ventasPorMedioDePago`, `cierresDeCaja`, `retirosPorSocio`, `mermasPorProducto`, `rendimientoProduccion`, `gastosPorCategoria`, `atencionesReporte`
- `trazabilidadPedido` — reconstruye la cadena completa para cada ítem de un pedido
- Helpers: `fechaRango()` y `construirWherePedido()`

**`src/modules/reportes/reportes.routes.ts`** — endpoints GET bajo `/api/reportes/`, RBAC `ADMINISTRADOR` + `SOCIO`, schema Zod de filtros (`desde`, `hasta`, `sucursalId`).

**`src/modules/dashboard/dashboard.service.ts`** — `resumenDashboard(filtros)` con queries en paralelo: totalVentas, cantidadPedidos, ticketPromedio, ventasPorMedio, totalGastos, totalRetiros, mermas, alertasPendientes, lotesConDesvio, cantidadAtenciones.

#### Frontend del módulo 3
- `frontend/src/api/dashboard.ts` y `frontend/src/api/reportes.ts` — capa de API tipada
- `frontend/src/features/admin/Dashboard.tsx` — tarjetas KPI + filtros de fecha y sucursal (página de inicio del panel admin)
- `frontend/src/features/admin/Reportes.tsx` — pestañas: Ventas, Medios de pago, Cierres de caja, Retiros, Gastos, Mermas, Producción, Atenciones, **Trazabilidad**

#### ✔ Trabajo del módulo 3 que el doc anterior daba por pendiente y YA ESTÁ HECHO (CORREGIDO 2026-08-06)
- **Tests de integración de reportes y dashboard** → existen (`reportes.test.ts`, `dashboard.test.ts`)
- **Timer de pedidos no retirados** → implementado: `pedidosNoRetiradosParaAvisar()` en `pedidos.service.ts` + job `setInterval` en `server.ts`, umbral en `src/lib/constantes.ts`
- **Trazabilidad completa por pedido** → implementado: `GET /api/reportes/trazabilidad/pedido/:id` + pestaña "Trazabilidad" en el frontend. Reforzado después por `d1e51cb` (elegir partida de origen al enviar), que convirtió la inferencia por fecha en un vínculo explícito
- **Historial de alertas con detalle y link al evento** → implementado: `linkOrigen()` en `Alertas.tsx` navega al lote / transferencia / turno que disparó la alerta, con scroll y resaltado en la pantalla destino

### Mejoras posteriores incorporadas (commits en `feature/modulo-2`)
- `4078ee5` — Recepción: el cajero ya no puede "confirmar igual"; queda trabada con alerta automática y la resuelve el ADMIN
- `d1e51cb` — Trazabilidad cerrada: elegir de qué partida sale cada envío
- `be86e84` — Cierre de lote: corregir lo realmente usado de cada insumo
- `381c30c` — POS: categorías en dos niveles, más vendidos fijo y buscador
- `a83a182` — POS: recargo por tarjeta con selector de porcentaje
- `114fd49` — POS: retiro de socio y venta a empleado con descuento configurable
- `9e67f86` — Preparación del despliegue a la nube (Railway)

### Comanderas — ✅ IMPLEMENTADO 2026-08-06 (falta probar contra el hardware real)

Se definió el hardware real de impresión de cocina/mostrador, reemplazando la previsión genérica "Epson TM-T20" del stack tecnológico original (§4). Decisiones validadas con el equipo:

- **Modelo elegido**: XPRINTER XP-V320N, 80mm, interfaces USB+LAN, protocolo **ESC/POS estándar** — el mismo protocolo previsto originalmente para la Epson, así que el diseño de software no cambia, solo el fabricante concreto.
- **2 comanderas por local de venta** (Local 1 y Local 2): una en **COCINA**, una en **MOSTRADOR/CAJA**. 4 unidades en total. Producción no tiene comandera.
- **Conexión**: socket TCP directo del backend a `ip:9100` de cada impresora (raw ESC/POS por red, sin driver de Windows ni spooler).
- **IP y puerto configurables desde el panel admin** (tabla `ConfiguracionComandera`), NO hardcodeados — permite reasignar la IP si la red del local la reasigna, sin tocar código ni redeployar.
- **Multi-impresión con tracking individual**: cada `TicketCocina` se intenta imprimir en TODAS las `ConfiguracionComandera` activas de la sucursal; cada intento se registra por separado en `ImpresionComandera`. Si falla una y funciona la otra, el sistema lo sabe con precisión — no es todo o nada.
- **Nunca bloquea**: si ninguna comandera responde, el pedido se confirma/modifica/anula igual. Alerta visual en el POS indica **cuál** comandera falló, no un error genérico.
- **La anulación imprime en papel**: confirmado con el equipo.
- **Control Ciego aplica también al ticket impreso**: ninguna comandera puede imprimir montos de dinero.

**Qué quedó implementado** (rama `feature/modulo-2`):
- `src/modules/comanderas/escpos.ts` — genera el buffer ESC/POS a mano, sin dependencia nueva. Code page CP850 para los acentos, con fallback ASCII para lo que no esté mapeado (preferible "lena" a un byte basura que la impresora dibuje como símbolo). Si en el hardware real salieran caracteres raros, se cambia la constante `CODE_PAGE_CP850` y la tabla `MAPA_CP850`: es el único lugar a tocar.
- `src/modules/comanderas/comanderas.service.ts` — socket TCP crudo contra `ip:puerto` (timeout 4 s), CRUD con auditoría, e impresión de prueba.
- `src/modules/comanderas/comanderas.routes.ts` — `/api/configuracion-comandera`, todo solo-ADMIN.
- Migración `20260806120000_comanderas_por_destino`.
- Frontend: pestaña **Comanderas** en Catálogo (solo admin) con alta, edición, activar/desactivar y botón "Imprimir prueba"; y banner en la caja cuando una comandera no imprime, diciendo cuál.
- Tests: 15 unitarios del generador ESC/POS y del diff de cambios (corren sin DB) + `tests/integration/comanderas.test.ts`, que levanta un servidor TCP real como impresora buena y usa un puerto cerrado como impresora caída.

**Dos decisiones de implementación que conviene conocer antes de tocar esto:**

1. **La impresión física ocurre DESPUÉS del commit, no dentro de la transacción del pedido.** La spec original decía "dentro de la transacción". Se cambió a propósito: esperar a dos impresoras por TCP con la transacción abierta sostendría los locks de stock durante segundos en el pico del turno (78 pedidos un domingo), y una impresora apagada pasaría de molestia a frenar la caja entera — justo lo que la regla "nunca bloquear por hardware" busca evitar. Dentro de la transacción solo se registra el `TicketCocina` y sus `ImpresionComandera` en estado pendiente; `despacharEnSegundoPlano()` hace el resto una vez commiteado.
2. **El ticket `ACTUALIZACION` muestra qué cambió** (agregado / quitado / cambio de cantidad) además del pedido completo, vía `calcularCambios()`. Repetir el pedido entero obligaba al cocinero a comparar dos tickets a mano en plena cocina.

**Lo que falta** (no se puede hacer sin las impresoras en la mano):
1. Probar contra una XP-V320N real: que la code page CP850 muestre bien los acentos, que el corte de papel funcione y que el ancho de 48 columnas sea el correcto para el rollo que usan.
2. Cargar las 4 IPs reales desde el panel admin cuando las impresoras estén instaladas en los locales.
3. Confirmar con Ariel/Pablo el **formato del ticket de MOSTRADOR**: se asumió copia idéntica al de COCINA. Si quieren algo distinto hay que rediseñar el contenido — pero en ningún escenario puede incluir precios ni montos (Control Ciego, §2).

---

## 10. PENDIENTES CONOCIDOS

> Tabla revisada contra el código el 2026-08-06. Las filas que el documento anterior daba por pendientes y ya estaban resueltas se movieron al bloque "Resueltos" del final, para que nadie rehaga trabajo ya entregado.

### Pendientes reales

| Pendiente | Impacto | Acción |
|---|---|---|
| **Prueba de las comanderas contra el hardware real** | El código está listo y testeado, pero nunca tocó una XP-V320N | Verificar acentos (code page CP850), corte de papel y ancho de 48 columnas con una impresora real. Único lugar a ajustar: las constantes de `escpos.ts` |
| **Cargar las 4 IPs reales de las comanderas** | Sin esto los pedidos se registran igual pero no sale ticket impreso | Pablo las carga desde Catálogo → Comanderas cuando estén instaladas, y usa "Imprimir prueba" para validar cada una |
| **Formato del ticket de comandera de MOSTRADOR** | Se asumió copia idéntica al de COCINA, sin confirmar | Confirmar con Ariel/Pablo. Restricción dura: nunca puede llevar montos de dinero (§2) |
| Fotos de remito en disco local | Se pierden en cada redeploy de Railway | Migrar a S3 o Cloudinary antes del go-live. **Bloqueado**: falta elegir proveedor |
| Bebidas sin precio fijo | En reportes de ventas aparecen con precio 0 | Definir con el cliente si tienen precio variable o se cargan manualmente |
| Motivos de atención sin validar | La lista puede no reflejar el negocio real | Mostrar a Pablo y Ariel en el próximo show |
| Peso real de una milanesa individual | Puede generar alertas de desvío falsas | Repreguntar a Pablo |
| Persona concreta para ENCARGADO | Rol habilitado pero sin asignado | Pendiente de definición del cliente |
| Ícono PWA real | Hoy es un SVG placeholder "L&C" | Falta arte de marca (PNG 192 y 512) |
| Variables de entorno y usuarios reales en producción | Secrets de dev y usuarios con contraseñas conocidas | Cargar `JWT_SECRET`/`JWT_REFRESH_SECRET` nuevos, `DATABASE_URL` de prod, y crear usuarios reales (nunca correr el seed de dev contra prod) |
| CORS y origen de Socket.io en producción | Solo se ve al desplegar con dominios separados | Verificar en el primer deploy |

### Fuera de alcance de v1 (no arrancar)

| Tema | Nota |
|---|---|
| Plan de costeo Fase B y C | Futura funcionalidad de rentabilidad |
| Conciliación con Mercado Pago | Hoy se hace a mano; los datos ya están en `Pago` |
| Facturación ARCA/AFIP | Campos previstos en `Pedido` (cuit, condicionIva, nroComprobante) |
| Pedidos por WhatsApp | `canalOrigen` previsto en `Pedido` |

### ✔ Resueltos (verificado en código 2026-08-06 — NO rehacer)

| Ítem | Dónde |
|---|---|
| Cookie `sameSite` para dominios cross-site | `src/modules/auth/auth.routes.ts` — `'none'` en producción, `'lax'` en dev |
| Endpoint de trazabilidad por pedido | `GET /api/reportes/trazabilidad/pedido/:id` + pestaña en Reportes |
| Timer de pedidos no retirados | `pedidosNoRetiradosParaAvisar()` + job en `server.ts` |
| Historial de alertas con link al evento | `linkOrigen()` en `Alertas.tsx` + deep-link en Producción/Transferencias/Turnos |
| Tests de reportes y dashboard | `tests/integration/reportes.test.ts`, `dashboard.test.ts` |
| Git housekeeping (`.claude/` versionado) | `.claude/` en `.gitignore`, nada trackeado |
| Verificación de la branch Neon `modulo-2-dev` | Migraciones al día en `neondb` y `polleria_test`, sin drift |
| Secrets JWT sin validar al arrancar | `src/config.ts` aborta en `NODE_ENV=production` si faltan |
| Comanderas reales (ESC/POS por TCP, 2 por local, panel admin, tracking por impresora) | `src/modules/comanderas/`, migración `20260806120000`, pestaña Comanderas en Catálogo |

---

## 11. REGLAS DE IMPLEMENTACIÓN — RECORDATORIO PARA CLAUDE CODE

1. **Backend primero, siempre**. Tests completos antes de tocar el frontend.
2. **Toda operación multi-tabla va en `$transaction` de Prisma**. Si falla algo, rollback completo de todo.
3. **La auditoría se implementa dentro de la misma transacción** con `registrarAuditoria(tx, ...)`. Nunca triggers de DB.
4. **El control ciego es server-side**: los serializers usan whitelist explícita (no blacklist) para filtrar campos por rol. Verificar con tests que inspeccionan el JSON crudo de la respuesta HTTP.
5. **El stock nunca puede ser negativo**. Validación bloqueante en TODAS las operaciones que consumen stock.
6. **Errores de negocio con códigos claros**: `STOCK_INSUFICIENTE`, `FICHA_SIN_VERSION_ACTIVA`, `TRANSFERENCIA_YA_CONFIRMADA`, `LOTE_YA_CERRADO`, `PRODUCTO_RESERVADO_SISTEMA`, `PROVEEDOR_RESERVADO_SISTEMA`, `CLAVE_INVALIDA`, etc.
7. **Moneda como `Decimal`**, nunca `Float`.
8. **Fechas en UTC en DB**, zona `America/Argentina/Cordoba` en presentación.
9. **Código, comentarios y nombres de dominio en español**.
10. **IDs: `Int @default(autoincrement())`** en todo el proyecto.
11. **Nunca editar una `FichaTecnicaVersion` existente**. Modificar receta = crear versión nueva + desactivar anterior en la misma transacción.
12. **Tests de RBAC**: al menos un endpoint por módulo debe tener test que verifica 403 para cada rol que no debería tener acceso.
13. **Tests de no-filtración de campos ciegos**: verificar inspeccionando el JSON crudo de la respuesta HTTP que `unidadesEsperadas`, `desvioPct`, `cantidadEnviada`, `diferencia`, `valorEsperado` no aparecen en respuestas de roles incorrectos.
14. **Impresión de comandas nunca bloquea el negocio** *(2026-08-06)*: toda impresión se intenta contra TODAS las `ConfiguracionComandera` activas de la sucursal del pedido; cada intento se registra individualmente en `ImpresionComandera`. Un fallo de hardware NUNCA impide confirmar, modificar o anular un pedido, y no afecta el resultado de la otra comandera. El contenido de `TicketCocina.contenido` nunca incluye montos de dinero.
15. **La fuente de verdad del schema es `prisma/schema.prisma`**, no el fragmento de §6. Antes de escribir una query o una migración, leer el modelo real.
16. **Después de traer cambios de schema** (`git pull`, `git am`), correr `npx prisma generate` a mano — no hay `postinstall` que lo dispare. Si no, el cliente de Prisma queda desactualizado y tira `Unknown argument <campo>` aunque la migración esté aplicada.
17. **`prisma migrate deploy` hay que correrlo DOS veces**: la base de desarrollo (`neondb`) y la de tests (`polleria_test`) son bases distintas dentro de la misma branch de Neon, cada una con su propio historial de migraciones. Correrlo solo en dev deja los tests de integración fallando con `The column X does not exist`, que parece un bug del código y no lo es. Para la de tests: setear `DATABASE_URL` apuntando a `polleria_test`, correr el deploy, y volver a limpiar la variable.
18. **Nunca pushear código que dependa de una migración sin haberla aplicado.** Si `migrate deploy` falla (credenciales, red), el push queda en un estado roto: el backend escribe contra tablas que no existen y la caja revienta al confirmar el primer pedido. Primero la migración, después el push.
