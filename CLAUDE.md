# CLAUDE.md — Sistema de Gestión "Limón & Chimi"
## Pollería en Córdoba, Argentina — documento maestro único

> **Qué es este archivo**: el contexto completo y autoritativo del proyecto. Reglas de
> negocio, arquitectura, estado real del código, decisiones tomadas y pendientes abiertos.
> Si vas a trabajar en este repo, leelo entero antes de tocar nada.
>
> **Qué NO es**: una spec aspiracional. Todo lo que dice acá fue verificado contra el
> código. Cuando algo está pendiente o sin decidir, lo dice explícitamente. **No inventes
> lógica de negocio que contradiga este documento**; si algo no está definido, está
> marcado como pendiente — preguntá antes de asumir.
>
> **Última consolidación: 2026-08-13.** Este documento reemplaza y absorbe ocho archivos
> que se acumularon por trabajar desde varias máquinas: `CLAUDE-MODULO-2.md`,
> `HANDOFF-AUDITORIA.md`, `HANDOFF-AUDITORIA-MODULO-2.md`,
> `HANDOFF-AUDITORIA-2026-08-07.md`, `INFORME-CUMPLIMIENTO-SPEC-2026-07-27.md`,
> `PRODUCCION-CHECKLIST.md`, `PROMPT-DISENO-FRONTEND.md` y `preguntas-pablo-whatsapp.txt`.
> Todos están en el historial de git si hace falta consultarlos.

**Los otros dos documentos del repo**: [`README.md`](README.md) (cómo correr, testear y
qué usuarios hay) y [`DEPLOY.md`](DEPLOY.md) (runbook de despliegue). Ninguno duplica
lógica de negocio — para eso está este archivo.

---

## 1. EL NEGOCIO

### 1.1 Qué hace la pollería

Pollería gastronómica en Córdoba. Vende pollos a la leña, milanesas, lomitos, empanadas,
hamburguesas, papas fritas y afines. Opera en **tres ubicaciones físicas**:

1. **Producción (central)**: recibe materia prima en bruto (por kilo) y la transforma en
   unidades listas para cocinar.
2. **Local de venta 1 (Limón y Chimi)**: recibe unidades ya producidas, cocina a pedido,
   vende y cobra.
3. **Local de venta 2**: ídem local 1.

El diferencial del negocio es la **separación intencional entre producción y venta**. La
materia prima se compra y procesa centralmente; los locales solo reciben, cocinan y cobran.

### 1.2 Qué problema resuelve el software

Hoy el control es manual (papel y Excel): no hay trazabilidad real del stock, no se sabe
qué se pierde ni por qué, y no hay control financiero de caja. El objetivo es
**trazabilidad completa desde que entra la materia prima hasta que se le cobra al
cliente**: todo registrado, todo con responsable, todo comparable contra lo que "debería
ser".

### 1.3 Volumen operativo (datos reales validados con el cliente)

- Facturación semanal: ~$12.848.750 ARS
- ~279 pedidos/semana, ~40 por turno, pico de ~78 órdenes en un turno de domingo
- 5-6 usuarios concurrentes máximo
- 2 turnos/día, **1 cajero por sucursal por turno**. Horario de atención confirmado el
  2026-08-28: **mediodía 10:00–16:00** y **noche 19:00–00:00**. El turno del sistema no
  está atado a esas horas (se abre y se cierra a mano), pero el selector de hora prometida
  del POS sí — ver §5 Flujo 4
- Mercado Pago domina (~61,5% de las ventas), efectivo ~38,5%
- Hasta 10 proveedores, pedidos rutinarios

**La complejidad está en el dominio de negocio, no en la escala técnica.** Esto importa
para dimensionar decisiones: no hace falta arquitectura distribuida, hace falta que las
reglas de control se cumplan sin excepción.

### 1.4 Las personas

| Nombre | Rol en el negocio | Rol en el sistema |
|---|---|---|
| **Pablo** | Dueño / administra | ADMINISTRADOR |
| **Ariel** | Socio, conoce la operación diaria | SOCIO |
| **Eliana** | Socia | SOCIO |
| **Ema** | Socio | SOCIO |
| Empleados de local | Atienden y cobran | CAJERO |
| Empleados de planta | Producen | PRODUCCION |
| (sin asignar) | — | ENCARGADO |

Los usuarios finales **no son técnicos**. Requisito textual del dueño: *"pensá que el
usuario es tonto y tiene que usarlo rápido y fluido, sin confusiones"*. Muchos lo usan con
las manos ocupadas o sucias, apurados y con ruido alrededor.

---

## 2. EL CONTROL CIEGO — PRINCIPIO RECTOR (INNEGOCIABLE)

> **El empleado que carga un conteo NUNCA ve el valor esperado antes de cargarlo. El
> sistema compara internamente y solo le informa las discrepancias al Administrador.**

**La razón**: si el empleado ve el número esperado, puede acomodar su conteo para que
"cuadre". El control ciego elimina esa posibilidad. No es una preferencia estética — es el
mecanismo de control de confianza sobre el que se apoya el negocio entero.

Atraviesa todo el sistema:

- Arqueo de apertura y cierre de caja: el cajero cuenta el efectivo físico sin saber
  cuánto debería haber.
- Arqueo de pollos marcados: ídem.
- Recepción de transferencias: el local receptor nunca ve la cantidad enviada por
  producción.
- Rendimiento esperado de producción: el operario nunca ve cuántas unidades debería haber
  producido.
- **Tickets impresos**: la comandera de MOSTRADOR la ve el cajero, así que ningún ticket
  puede llevar precios ni totales en pesos.

**Cómo se implementa**: la defensa es **server-side**, con **whitelist explícita** en los
serializers (nunca blacklist — una blacklist se rompe sola en cuanto alguien agrega un
campo). Los serializers viven en:

- `src/modules/turnos/turnos.serializers.ts`
- `src/modules/transferencias/transferencias.serializers.ts`
- `src/modules/produccion/produccion.serializers.ts`

Y hay tests que inspeccionan el **JSON crudo** de las respuestas HTTP, no los tipos de
TypeScript: `tests/integration/rbac-y-campos-ciegos.test.ts`.

### 2.1 Una desviación consciente y documentada

`turnos.serializers.ts` expone `conceptosConDiferencia` al CAJERO: le dice **cuál** de los
dos arqueos no cerró (efectivo, pollos, o los dos), **sin monto ni dirección**.

Viene de un pedido explícito de Pablo en la reunión del 4/8: *"que no pierdan tiempo — si
es la plata, o si es lo del pollo"*. **No es un bug**, pero es una relajación de la
lectura estricta de esta sección y conviene que quede consciente: el cajero sabe algo que
el principio puro diría que no debería saber.

---

## 3. ROLES Y PERMISOS

| Rol | Quién | Qué puede hacer |
|---|---|---|
| **ADMINISTRADOR** | Pablo | Acceso total. CRUD de usuarios, productos, precios, fichas técnicas, stocks mínimos, recargos, comanderas. Recibe TODAS las alertas. Desbloquea turnos, genera claves de emergencia, ve reportes financieros completos. El único que "mete mano" en datos. |
| **SOCIO** | Ariel, Eliana, Ema | **Solo lectura**. Reportes, informes, historial, auditoría, dashboard. NO modifica ningún dato. Pedido explícito del cliente: *"que no rompamos nada sin querer"*. |
| **ENCARGADO** | A definir | Operativo. Opera el POS igual que CAJERO. Ve stock de su local. Sin acceso a información financiera ni de rentabilidad. |
| **CAJERO** | Empleados de local | POS, caja, arqueos, gastos, retiros, mermas. No ve montos esperados, diferencias de caja ni datos financieros. Al cerrar turno solo ve el resumen de ventas **por unidad**. |
| **PRODUCCION** | Empleados de planta | Solo el módulo de producción: ingresos de mercadería, lotes, transferencias salientes. Interfaz pensada para celular. No ve rendimientos esperados, desvíos ni alertas. |

### Reglas transversales de roles

- **Toda acción que modifica datos queda asociada al usuario logueado** (la "firma
  digital"). Los usuarios no deben compartirse.
- Cada CAJERO y ENCARGADO tiene `Usuario.sucursalId` asignado. **El backend valida siempre
  contra la DB que el usuario opera en su propia sucursal — nunca confía solo en el JWT.**
  Ver `resolverSucursalOperativa()` en `turnos.service.ts`.
- Un CAJERO de Local 1 no puede ver ni operar en Local 2. Error 403 si lo intenta.
- PRODUCCION: cero acceso a ventas y caja.
- SOCIO: cero acceso a endpoints de escritura. Cualquier POST/PUT/PATCH/DELETE → 403.

---

## 4. STACK Y ARQUITECTURA (DECIDIDO — NO CAMBIAR)

```
BACKEND
├── Node.js ≥22 + TypeScript
├── Fastify 5 (framework HTTP)
├── Prisma 6 (ORM)
├── PostgreSQL 15 (Neon)
├── Socket.io 4 (WebSockets con salas por sucursal)
├── JWT propio + refresh tokens en cookies httpOnly (NO servicios de terceros)
└── Zod 4 (validación de inputs)

FRONTEND
├── React 18 + TypeScript
├── Vite (build)
├── Tailwind CSS v4
├── React Query (@tanstack/react-query)
└── PWA (SPA — NO Next.js, no hace falta SEO)

INFRA
├── Neon (PostgreSQL)
├── Railway (backend)
├── Cloudflare Pages / Workers (frontend estático)
└── Cloudflare R2 (fotos de remito — bucket público, S3-compatible)
```

### Decisiones de arquitectura tomadas (no rediscutir)

- **Web app cloud + PWA.** Descartados: Electron, offline-first, app nativa, Odoo.
- **NO hay offline en v1.** El fallback es papel (como operan hoy). Solo banner de "sin
  conexión" + cache de catálogo por Service Worker.
- **Multi-sucursal desde el día 1**: toda tabla relevante tiene `sucursalId`.
- **IDs `Int @default(autoincrement())` en TODO el proyecto.** El borrador original del
  cliente proponía `cuid()`; se descartó por consistencia. No hay excepciones.
- **Los combos NO tienen modelo propio**: son `Producto` con `tipo: COMBO` +
  `ComboComponente`. No existe `comboId` en `ItemDePedido` ni en `Atencion`. Un combo se
  vende como cualquier producto y al confirmar el backend recorre sus componentes.
- **Moneda como `Decimal`**, nunca `Float`. Montos `Decimal(12,2)`, cantidades/stock
  `Decimal(12,3)`.
- **AFIP/ARCA fuera de v1**, pero `Pedido` deja previstos `cuit`, `condicionIva`,
  `nroComprobante`.
- **Código, comentarios y nombres de dominio en español.** Español rioplatense (vos/tenés)
  también en los textos de UI.

### Hardware — comanderas (decidido 2026-08-06)

- **Modelo**: XPRINTER XP-V320N — térmica 80mm, USB+LAN, **protocolo ESC/POS estándar**.
- **2 comanderas por local de venta**: una en **COCINA**, una en **MOSTRADOR/CAJA**. Cuatro
  unidades en total. **Producción no tiene comandera.**
- **Conexión**: la impresora escucha en el puerto TCP **9100** (raw socket / "JetDirect")
  de su IP dentro de la LAN del local. El backend abre un socket TCP y manda el buffer
  ESC/POS directo — **sin driver de Windows ni spooler de por medio**.
- **IP y puerto de cada comandera son configurables desde el panel admin** (tabla
  `ConfiguracionComandera`), nunca hardcodeados: si la red del local reasigna la IP, se
  cambia sin tocar código ni redeployar.

### Reglas de UX que vienen del cliente (aplican al frontend)

- **Botones enormes** (mínimo 56px de alto, texto 18px+), alto contraste.
- **Una acción principal por pantalla.** Nada de dashboards con 15 opciones para el
  operario.
- **Flujos lineales tipo wizard**: paso 1 → paso 2 → confirmación, siempre visible en qué
  paso estás.
- **Teclado numérico grande en pantalla** para cargar cantidades (estilo calculadora, no
  un input chiquito).
- **Confirmación visual fuerte** al terminar (pantalla verde con check gigante, no un
  toast).
- **Errores en lenguaje simple**: *"No hay suficiente nalga. Tenés 5 kg y quisiste usar 9
  kg."* Nunca códigos técnicos en pantalla.
- **PRODUCCION usa el sistema desde el CELULAR** (mobile-first estricto en sus pantallas).
  Los demás roles: tablet/PC — pero todo el panel admin y el POS son responsive y usables
  en celular desde los commits `9ed13bd`/`08fd853`/`9c8c742`.

---

## 5. LOS 7 FLUJOS DE NEGOCIO

### FLUJO 1 — Ingreso de materia prima

**Actores**: Proveedor (externo) · Usuario PRODUCCION · Sistema
**Empieza**: llega un proveedor con mercadería. **Termina**: el stock de materia prima
queda actualizado en producción.

1. El proveedor llega con remito o factura.
2. El usuario de Producción **pesa y cuenta físicamente** cada producto. Lo que importa es
   el **peso real medido**, no lo que dice el remito.
3. Carga el ingreso (optimizado para celular):
   - **Proveedor**: de lista precargada (máx ~10). Existe la opción **"Otro"**, que
     habilita un campo de comentario libre **obligatorio**. Sin comentario, no avanza.
   - **Fecha y hora**: automáticas del servidor. El cliente no puede manipularlas.
   - **Foto del remito**: opcional, solo respaldo visual — el sistema NO la procesa. Va a
     Cloudflare R2.
   - **Líneas de ingreso**: por cada producto → tipo de materia prima,
     `cantidadSegunRemito` **y** `cantidadRealPesada`. Ambos obligatorios. La diferencia
     queda registrada implícitamente.
4. Validación: proveedor obligatorio, ≥1 línea, cantidades > 0.
5. **REGLA CRÍTICA**: cada línea queda como **`LineaIngreso` identificable independiente**.
   NO se fusiona con otras líneas del mismo producto. Dos líneas del mismo producto en un
   ingreso = dos `LineaIngreso` separadas. **Esta es la base de la trazabilidad por
   partida.**
6. `cantidadRestanteDisponible` inicial = `cantidadRealPesada` (no el remito).
7. El stock de producción aumenta vía `MovimientoStock` tipo `INGRESO_COMPRA` por
   `cantidadRealPesada`.
8. Todo en transacción atómica + `RegistroAuditoria` con acción
   `REGISTRAR_INGRESO_MERCADERIA`.

**Todos los insumos pasan por acá**: carnes, pan rallado, huevos, condimentos, papas,
pollos frescos, discos de empanada. Todo producto tiene su stock.

**Ayuda de carga**: cada proveedor tiene `productosHabituales` (relación N:N con
`Producto`, sin cantidades) que el admin configura una vez en Catálogo → Proveedores. Al
cargar un ingreso aparecen como acceso rápido en vez de buscar cada producto de cero.

---

### FLUJO 2 — Producción y conversión

**Actores**: Usuario PRODUCCION · Sistema · ADMINISTRADOR (recibe alertas, no interviene)

1. El usuario elige qué producto elaborado va a producir. La lista se filtra a los
   productos **con ficha técnica activa** (`GET /produccion/productos-producibles`) — no
   aparecen los que se arman en el local ni los productos de sistema.
2. **Selección de `LineaIngreso` de origen**: el sistema muestra las líneas con
   `cantidadRestanteDisponible > 0` de la materia prima principal. El usuario elige sobre
   cuál(es) trabaja. **La trazabilidad va por partida.**
3. El usuario carga **TODOS los insumos que usa**, no solo la carne principal: kg de
   nalga, kg de pan rallado, cantidad de huevos, condimentos. Cada insumo referencia su
   línea de ingreso de origen y se descuenta de su propio stock.
   - Los insumos de la ficha vienen **precargados** al elegir qué producir
     (`GET /produccion/productos/:id/insumos-esperados` — devuelve **solo identidades**,
     sin cantidades ni rendimiento: el control ciego queda intacto), con reparto automático
     FIFO entre partidas y edición a mano antes de confirmar.
4. **VALIDACIÓN BLOQUEANTE (INNEGOCIABLE)**: si la cantidad de CUALQUIER insumo supera el
   stock disponible (tanto en el agregado de `MovimientoStock` como en
   `cantidadRestanteDisponible` de la línea específica) → error `STOCK_INSUFICIENTE`. El
   lote NO continúa. **NUNCA stock negativo.** Si falta mercadería, hay que ir al Flujo 1
   primero.
5. **La versión activa de la ficha técnica se congela** en el lote al abrirlo
   (`fichaTecnicaVersionId` queda fijo). Si después se crea una versión nueva de la
   receta, el lote en curso sigue usando la original.
6. **CONTROL CIEGO (INNEGOCIABLE)**: el sistema calcula internamente cuántas unidades
   deberían salir según la ficha, pero **ese cálculo no se expone nunca al rol
   PRODUCCION** — ni al abrir, ni al cerrar, ni en ningún endpoint.
7. El usuario produce y cierra el lote cargando `unidadesProducidasReales` y
   `desperdicioRealKg`.
8. El sistema calcula el desvío. Si supera el `umbralDesvioAlertaPct` de la versión de
   ficha → **alerta silenciosa solo para ADMINISTRADOR** (producto, lote, operario,
   esperado, real, desvío). **El operario nunca la ve ni sabe que se disparó. El flujo NO
   se bloquea por desvío.**
9. Al cerrar, en una sola transacción atómica: descuenta cada insumo de su stock y de la
   `cantidadRestanteDisponible` de su `LineaIngreso` (`CONSUMO_PRODUCCION`), suma las
   unidades producidas (`PRODUCCION_ALTA`), registra el desperdicio
   (`DESPERDICIO_PRODUCCION`), guarda el desvío, dispara la alerta si corresponde y
   registra auditoría. Si algo falla, rollback completo.

#### Fichas técnicas y versionado (CRÍTICO)

- Cada producto elaborado tiene **UNA** `FichaTecnica` con **N** `FichaTecnicaVersion`.
  **Solo UNA versión activa a la vez.**
- La versión contiene: número, `fechaDesde`, `activa`, `rendimientoEsperado`,
  `desperdicioEsperadoPct`, `umbralDesvioAlertaPct` y la lista de `IngredienteDeReceta` con
  `cantidadPorUnidadProducida`. El ingrediente con `esPrincipal: true` es la base del
  cálculo de rendimiento.
- **Modificar una receta = crear versión nueva + desactivar la anterior en la misma
  transacción. NUNCA editar una versión existente.**
- Los lotes históricos apuntan a la versión vigente cuando se produjeron: los reportes
  históricos no se alteran por cambios de receta.
- **Constraint en DB**: índice único parcial `WHERE activa = true` por ficha (migración
  `20260710150000_uq_una_version_activa_por_ficha`). No puede haber dos versiones activas
  de la misma ficha.

#### Recetas reales cargadas (validadas con el cliente)

- **Milanesa de nalga**: 250 g de nalga + proporción de pan rallado, huevo y condimentos.
- **Empanada de pollo** (receta real, para 72 unidades): 2,5 pollos enteros, 72 discos,
  3 kg cebolla, 3 pimientos, 0,25 atado de verdeo, 12 huevos.
- **Empanada de carne**: 1 kg carne molida, 24 tapas, 1 kg tomate, 1 kg cebolla = 24
  empanadas.
- **Medallón de hamburguesa, hamburlomo, bife de lomo, bife de pollo**: se producen en la
  planta central (confirmado por Ariel).
- **Pollo a la leña (entero)**: 1 pollo fresco → 1 pollo cocido.
- **Desperdicio esperado 0% en todas las fichas**: confirmado por el cliente el 2026-07-17
  — *las cantidades de las recetas ya incluyen el desperdicio*. A calibrar con lotes
  reales.
- **Milanesa del sándwich**: la ficha usa 250 g de nalga como **porción máxima**. El
  cocinero puede usar 1 o 2 milanesas según el peso de cada una para llegar a esa porción.
  El sistema descuenta **la porción (1 unidad)**, no milanesas físicas.

---

### FLUJO 3 — Transferencia interna (remito virtual)

**Actores**: PRODUCCION (emisor) · usuario del local (receptor) · Sistema · ADMIN (alertas)

**Generación (rol PRODUCCION)**
1. Elige sucursal destino, producto y cantidad **en UNIDADES** (no kilos).
2. Puede **elegir explícitamente de qué partida (lote de producción) sale cada producto** —
   pedido de Pablo: *"que te deje seleccionar el de 15 y después 45 del lote de 90, aunque
   queden dos líneas"*. Esto cerró el último eslabón de trazabilidad que antes se inferían
   por fecha.
3. El sistema valida stock disponible. Sin stock suficiente, no genera la transferencia.
4. Al confirmar: estado `PENDIENTE_RECEPCION`, el stock de producción se descuenta
   (`TRANSFERENCIA_SALIDA`), `usuarioEmisor` queda como firma. Transacción atómica.

**Traslado físico** (fuera del sistema).

**Recepción — CONTEO CIEGO (INNEGOCIABLE)**
5. El usuario del local ve la transferencia pendiente: producto y origen. **NUNCA ve la
   cantidad enviada.** La API no incluye `cantidadEnviada` ni `diferencia` en ninguna
   respuesta al receptor.
6. Cuenta físicamente y carga su número.
7. El sistema compara internamente.

**Si coinciden**: estado `CONFIRMADA`, el stock del local aumenta
(`TRANSFERENCIA_ENTRADA`), quedan registrados `usuarioReceptor` y `fechaHoraRecepcion`.

**Si NO coinciden**:
- Respuesta al receptor: `{ coincide: false, mensaje: "Los números no coinciden. ¿Recontar
  o confirmar igual?" }` — **sin revelar la diferencia, sin decir cuánto envió producción,
  sin decir de qué lado está el error**. El mensaje es idéntico sin importar el tamaño de
  la diferencia (no da pistas).
- El stock NO se modifica. La transferencia sigue en `PENDIENTE_RECEPCION`.
- El receptor puede recontar sin límite de intentos.

**Confirmar con discrepancia — quién decide**
> **Cambio implementado (commit `4078ee5`)**: el cajero **ya NO puede** ejecutar "confirmar
> igual" por su cuenta. La recepción queda trabada, se genera la alerta automática, y **la
> decisión de con qué cantidad entra la mercadería es del ADMINISTRADOR**, desde el panel
> de Transferencias ("REVISAR Y CERRAR", ver `frontend/src/features/admin/Transferencias.tsx`).
> El resto de la mecánica ciega no cambia: el cajero sigue sin ver la cantidad enviada.

- Estado `CONFIRMADA_CON_DISCREPANCIA`.
- El stock del local aumenta por la **cantidad declarada por el receptor** (NO la enviada).
- **Alerta al ADMINISTRADOR** con producto, cantidad enviada, cantidad recibida,
  diferencia, fecha/hora y **ambos usuarios** (emisor y receptor).
- **El sistema NUNCA se bloquea por discrepancia.** La operación continúa.

**Retorno a producción (desde los locales)**

Cuando un producto vuelve de un local a producción (ej: pollo cocido no vendido), el
sistema, en una sola transacción:
- Descuenta del stock del local (`RETORNO_A_PRODUCCION` negativo).
- Suma al stock de producción (`RETORNO_A_PRODUCCION` positivo).
- **Crea automáticamente una `LineaIngreso` sintética** con el proveedor de sistema
  "Retorno interno" (`esProveedorSistema: true`) y comentario *"Retorno desde [local] —
  turno [turnoId]"*. Así **la cadena de trazabilidad no se rompe** y el operario puede usar
  ese material en un lote seleccionando esa línea como origen.

---

### FLUJO 4 — Venta en el POS

**Actores**: Cliente · Cajero · Cocina (recibe tickets) · Sistema

#### Reglas de pantalla

- Interfaz táctil con botones grandes, agrupados por categoría.
- **Categorías en dos niveles**: el cajero elige primero la "categoría madre" (Pollos,
  Sándwiches, Empanadas…) y después la categoría. Con 16 categorías vendibles, una sola
  fila de chips no entra en la tablet (reunión 4/8). `Producto.categoriaMadre` es editable
  desde Catálogo; `null` cae en "Otros".
- Los productos se ordenan por **más vendidos primero**, calculado automáticamente desde el
  historial de `ItemDePedido` por sucursal (`GET /pedidos/mas-vendidos`). **No es orden
  manual.** Hay además un bloque fijo de "más vendidos" y un buscador.
- El total del pedido se actualiza en tiempo real. El carrito siempre está visible.
- **`nombreCliente` es OBLIGATORIO para confirmar** (regla de negocio, 2026-08-28): sin
  nombre el botón CONFIRMAR PEDIDO queda deshabilitado, con borde rojo en el campo y el
  mensaje *"Poné el nombre del cliente para confirmar."* Aplica a los **dos** tipos de
  pedido, no solo a A_RETIRAR: es con lo que se llama al cliente, lo que se imprime en la
  comanda y lo que busca el buscador de Pedidos activos.
  > La validación es **de pantalla**. En el backend `nombreCliente` sigue siendo
  > `z.string().max(80).optional()`: el POS es el único que crea pedidos, y endurecer el
  > Zod rompería los tests de integración que confirman sin nombre. Si alguna vez se
  > agrega otro canal de alta (WhatsApp), hay que subir la regla al backend.
- La **hora prometida** sigue siendo opcional, y sale del selector de horarios fijos
  (`SelectorHorario`) — nada de tipeo libre. Se ofrecen **solo las horas en que el local
  atiende**, en pasos de 15 minutos y separadas por tramo (2026-08-28):
  **Mediodía 10:00–16:00** y **Noche 19:00–00:00**, ambos extremos inclusive. Antes se
  listaba el día entero (96 franjas) y el cajero scrolleaba por 40 botones muertos.
  Cambiar los horarios de atención = tocar la constante `TRAMOS` de `SelectorHorario.tsx`,
  nada más depende de ella.
  > El cierre de la noche es `00:00`, que ya es el día siguiente. `estadoHora()` en
  > `PedidosActivos.tsx` corrige el salto: un desfasaje de más de 12 h hacia atrás se lee
  > como "mañana", si no un pedido cargado 23:00 para las 00:00 salía en rojo al instante.

#### Catálogo y precios

- **Pollos**: se venden por porción → **entero** o **medio**. Son productos distintos del
  catálogo (botones separados en la grilla, sin modal intermedio).
- **Combos/promos**: precio propio, no calculado por descuento. Al venderlos, el stock se
  descuenta **por cada componente** (`ComboComponente`), nunca por el combo en sí (los
  combos no tienen stock propio).
- **Precio escalonado por volumen** (`Precio.cantidad`): ej. empanadas 1 = $X, 6 = $Y,
  12 = $Z. También aplica a combos (dato real del cliente: 1 pollo c/fritas $29.000, pero 2
  son $56.000, no $58.000). El algoritmo es: **tier exacto si existe, si no descomposición
  greedy de mayor a menor** (13 empanadas = 12 + 1).
  - Frontend (`frontend/src/lib/precios.ts`) y backend
    (`src/modules/pedidos/pedidos.calculos.ts`) implementan el mismo algoritmo — el
    frontend solo para mostrar el total en vivo. **La autoridad del precio es el backend al
    confirmar.**
- Los **precios vigentes** son legibles por CAJERO y ENCARGADO (el precio de venta no es
  dato ciego: se lo cobran al cliente). El **historial** de cambios de precio es solo ADMIN
  y SOCIO.
- El precio se **congela** al confirmar en `ItemDePedido.montoTotal` (fuente de verdad del
  cobro) y `precioUnitario` (referencia = total/cantidad). Con tabla de volumen, el total
  de N unidades **no** es N × unitario — por eso se congela el total de línea.

#### Tipos de pedido

- **PRESENCIAL**: el cliente está en el local, se cobra en el momento. Puede cobrarse
  directo desde `EN_PREPARACION`.
- **A_RETIRAR**: pedido por teléfono o WhatsApp. Queda en lista de pendientes. Se cobra
  cuando el cliente llega.

#### Descuento de stock — CUÁNDO (INNEGOCIABLE)

**El stock se descuenta al CONFIRMAR el pedido (al pasarlo a `EN_PREPARACION`), NO al
cobrar.**

Validado explícitamente con Ariel: *"Si se mandó a preparar, se consumió, se retire o no."*
Si el cliente no viene, el stock ya se consumió.

**Excepción única**: si se ANULA un pedido `EN_PREPARACION` o `LISTO`, el stock SÍ se
repone (`ANULACION_REPOSICION`).

#### Estados del pedido (INNEGOCIABLE)

```
Cargando ítems (vive en el frontend, no persistido)
       ↓ [cajero confirma → POST /pedidos]
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
                          (costo cero, DESPERDICIO_QUEMADO)

Desde EN_PREPARACION o LISTO:
       ↓ [cajero anula]
    ANULADO → repone TODO el stock
```

**Reglas de transición:**
- Un pedido `ENTREGADO` **jamás** se puede anular.
- La **reasignación** NO descuenta stock de nuevo: crea un pedido nuevo `LISTO` con los
  precios congelados del original y lo vincula por `pedidoOrigenId`.
- `PERDIDO` **no repone** stock (el producto se consumió/tiró).
- Un pedido `ANULADO` guarda en auditoría el **pedido COMPLETO tal como estaba** — todos
  los ítems y precios, no solo "fue anulado".
- **Timer de no retirados**: `Pedido.fechaListoNoRetirado` + `avisoNoRetiradoEmitido`, con
  un job `setInterval` en `server.ts` cada 2 min. Umbral: 30 minutos
  (`MINUTOS_PEDIDO_NO_RETIRADO_ALERTA` en `src/lib/constantes.ts`) — **es el default de la
  spec, sin confirmar con Pablo**.

#### Cobro

- Se puede pagar con **combinación de medios** en un mismo pedido.
- Medios: `EFECTIVO`, `DEBITO`, `CREDITO`, `MERCADO_PAGO`, `TRANSFERENCIA`.
- **Vuelto automático solo cuando hay EFECTIVO.** El `Pago` de tipo `EFECTIVO` se persiste
  **NETO de vuelto** (lo que quedó físicamente en la caja — así el arqueo cuadra). El
  bruto y el vuelto quedan en el `RegistroAuditoria` de `COBRAR_PEDIDO`.
- Si el pago es 100% electrónico con monto mayor al total → error `VUELTO_SIN_EFECTIVO`.
- **Recargo por tarjeta**: el admin deja cargados porcentajes con nombre
  (`RecargoTarjeta`, ej. "Visa crédito 3 cuotas") y el cajero los elige de una lista al
  cobrar, en vez de tipearlos (reunión 4/8). Solo `DEBITO` y `CREDITO`. Se guarda en
  `Pago.recargoPct` y `Pago.montoRecargo`; **`Pago.monto` NO incluye el recargo**, para que
  el total del pedido siga cerrando contra la suma de los montos. No es dato ciego: el
  cliente ve el recargo.

#### Descuentos (y el retiro de socio, que ya no está en el POS)

**Todo pedido del POS es una venta normal.** El descuento —empleado, encargado, o el que
el admin haya cargado— **se elige en la pantalla de cobro**, no al armar el carrito:
botón "− Descuento" → `SelectorDescuento` con la lista de `TipoDescuento`
(`GET /descuentos`) y "SIN DESCUENTO" siempre arriba.

- Se aplica **por línea y redondeando hacia abajo** a pesos enteros (`aplicarDescuentoEmpleado`
  en el backend; `CobrarPedido.tsx` espeja el mismo `Math.floor`): el empleado nunca paga
  de más por un redondeo y la suma de las líneas da exacto el total.
- El `%` queda **congelado en `Pedido.descuentoPct`** al cobrar. Cambiarlo después no toca
  lo ya vendido, y si el pedido se modifica se le reaplica **el suyo**, no el vigente.
- Un pedido normal **no** se puede cerrar sin pagos (`PAGO_INSUFICIENTE`): la vía sin cobro
  existe solo cuando el total es 0.

**El "Retiro de socio (no se cobra)" salió del POS el 2026-08-28**, a pedido de Pablo: no
lo usaban, y el selector de descuentos al cobrar ya cubre el caso. Se eliminó el switch,
los tres botones de socio y el modal de cierre sin pagos.

- **El backend NO cambió.** `POST /pedidos` sigue aceptando `beneficiario` y
  `socioBeneficiario`, y `POST /:id/cobrar` sin pagos sigue cerrando un pedido de total 0
  como `ENTREGADO` sin ningún `Pago`, auditado como `ENTREGAR_SIN_COBRO`. Los pedidos
  históricos con `tipoCostoCero = RETIRO_SOCIO` y el reporte de retiros por socio siguen
  funcionando: lo que se sacó es **la puerta de entrada en pantalla**, no el circuito.
- Si algún día lo quieren de vuelta, es UI nueva sobre un backend que ya lo soporta.
- El retiro de **plata** nunca estuvo acá: sigue en Operaciones de caja (Pablo lo aclaró
  expresamente). Eso no se tocó.

> `ConfiguracionGeneral` es una tabla clave-valor a propósito: cada parámetro nuevo que el
> admin deba poder tocar no debería costar una migración.

#### Atenciones / regalías

- Producto o combo sin cargo.
- Datos obligatorios: producto/combo, cantidad, motivo (lista predefinida + opción "OTRO"
  con texto libre obligatorio).
- El stock se descuenta igual que una venta (`MovimientoStock` tipo `ATENCION`), usando el
  **mismo resolvedor** que las ventas (combos → componentes, pollo → MARCADO).
- **No genera `Pago`.** Queda en el historial del turno como egreso de stock.
- El usuario logueado queda como responsable.

#### Venta a costo cero (mermas y retornos)

Desde la misma pantalla del POS:

- **`DESPERDICIO_QUEMADO`**: producto destruido, no aprovechable. El stock muere ahí
  (`MERMA_QUEMADO`). No mueve caja. Se agrupa en reportes: *"esta semana se quemaron X
  pollos, Y milanesas"*.
- **`RETORNO_A_PRODUCCION`**: producto cocido no vendido que vuelve como insumo. Descuenta
  del local, suma a producción, y **crea `LineaIngreso` sintética** (ver Flujo 3). No mueve
  caja.

#### Circuito especial del pollo (INNEGOCIABLE)

El pollo tiene tres estados de stock que los demás productos no tienen:

1. **Pollo fresco/preparado** (en freezer, unidades): llega por transferencia desde
   producción. Producto: *"Pollo a la leña (entero)"*.
2. **Pollo marcado** (en la parrilla, disponible para vender): el cajero/parrillero
   registra cuántos puso a cocinar con `EventoMarcadoPollo`. Descuenta del fresco, suma a
   *"Pollo a la leña (entero) — MARCADO"* (`MARCADO_POLLO`).
3. **Pollo vendido**: la venta de pollo (entero o medio, suelto o en combo) descuenta **del
   producto MARCADO**, nunca del fresco. Medio = 0,5.

**Destinos del pollo marcado no vendido al cierre del turno:**
- **Sigue apto**: queda en el conteo de marcados, pasa al turno siguiente.
- **Reutilizable** (para empanadas de pollo, tarta, escabeche): `RETORNO_A_PRODUCCION` →
  crea `LineaIngreso` sintética en producción.
- **Quemado/inaprovechable**: `DESPERDICIO_QUEMADO` → sale del sistema.

**Protección del producto MARCADO**: tiene `esProductoSistema: true`. No puede renombrarse
ni desactivarse desde el CRUD de catálogo (error `PRODUCTO_RESERVADO_SISTEMA`, 409).
Cambiarle la categoría sigue permitido.

> **Pendiente de repreguntar al cliente**: el modelado del pollo marcado como producto
> aparte fue una decisión de diseño, **no validada explícitamente**. Falta confirmar qué
> pasa físicamente con la otra mitad cuando se vende un medio pollo (¿queda disponible para
> otro cliente, o se descarta/retorna?).

#### Comanderas — impresión de tickets

**Cuándo se imprime** (dispara `TicketCocina` con su `tipo`):
- Al **confirmar** un pedido → ticket `NUEVO`.
- Al **modificar** un pedido `EN_PREPARACION` → ticket `ACTUALIZACION`.
- Al **anular** un pedido → ticket `ANULACION`. **Confirmado con el cliente: la anulación
  SÍ requiere ticket físico** — no alcanza con la alerta visual en el POS, la cocina tiene
  que enterarse en papel de que deje de preparar algo cancelado.

**Contenido del ticket**:
- **Encabezado**: sucursal, **Nº de pedido** (`Pedido.id`, bien grande), tipo de pedido,
  fecha y hora.
- **Cuerpo**: cada ítem → cantidad + nombre (los combos se **desglosan en sus
  componentes**, nunca "Combo X" sin detalle) + `aclaraciones` resaltadas ("sin sal", "bien
  cocido"). Las atenciones se imprimen igual que cualquier ítem — a cocina no le importa si
  se cobra o no.
- **Pie**: tipo de ticket bien marcado si es `ACTUALIZACION` o `ANULACION`.
- **NUNCA**: montos de dinero, precio unitario ni total en pesos — en **ninguna** de las
  dos comanderas (Control Ciego, §2).

**El ticket `ACTUALIZACION` muestra qué cambió** (agregado / quitado / cambio de cantidad,
vía `calcularCambios()`) **además** del pedido completo. Repetir el pedido entero obligaba
al cocinero a comparar dos papeles a mano en plena cocina.

**Multi-impresión con tracking individual:**
1. Dentro de la transacción del pedido se crea el `TicketCocina` con su `contenido`
   (snapshot JSON) y una `ImpresionComandera` **pendiente** por cada
   `ConfiguracionComandera` activa de la sucursal (normalmente 2).
2. **La impresión física ocurre DESPUÉS del commit, no dentro de la transacción.**
   `despacharEnSegundoPlano()` abre un socket TCP a `ip:puerto` (timeout 4 s) y manda el
   buffer ESC/POS. Las dos comanderas se despachan con `Promise.all`, así una colgada no
   demora a la otra.
   > **Por qué se desvió de la spec original** (que decía "dentro de la transacción"):
   > esperar a dos impresoras por red con la transacción abierta sostendría los locks de
   > stock durante segundos en el pico del turno (78 pedidos un domingo), y una impresora
   > apagada pasaría de molestia a **frenar la caja entera** — justo lo que la regla "nunca
   > bloquear por hardware" busca evitar.
3. **El pedido se confirma/modifica/anula SIEMPRE**, sin importar si alguna (o las dos)
   comandera falló.
4. Si alguna no respondió, se emite `comandera:fallo` a la sala de la sucursal y el POS
   muestra un banner no bloqueante indicando **cuál** falló (ej: *"No se imprimió en
   MOSTRADOR — avisar a cocina a viva voz"*), nunca un error genérico.
5. **Reimpresión**: `POST /api/configuracion-comandera/tickets/:ticketId/reimprimir` está
   habilitado a CAJERO/ENCARGADO de la sucursal del ticket (es la **única** ruta de
   comanderas que no es solo-ADMIN: cargar una IP es infraestructura, volver a mandar una
   comanda es operación de mostrador). Rearma las impresiones con las comanderas activas de
   hoy y devuelve el resultado **por impresora**.

**Cómo le llegan los bytes a la impresora — directo o vía agente** (agregado 23/8, tras el
primer intento contra hardware real): `enviarBufferATcp()` (`comanderas.service.ts`) abre el
socket TCP directo, pero **el backend corre en Railway** (nube) y no tiene ruta a las IPs
privadas de la LAN del local. Por eso, antes de mandar cada ticket,
`enviarTicket(sucursalId, ...)` decide:
- Si la sucursal **no tiene** `AgenteImpresion` configurado → TCP directo, igual que
  siempre (sirve para dev local o un deploy que sí esté en la misma LAN que las
  comanderas).
- Si **sí tiene** agente configurado → se le relaya el buffer por Socket.io (sala
  `agente-impresion:<sucursalId>`, ver `agente-impresion.service.ts` y
  `agente-impresion/` en la raíz del repo) y es el agente — un proceso corriendo en una
  PC del local — el que hace el TCP directo desde adentro de la LAN. Si el agente no está
  conectado, falla al toque con `AGENTE_IMPRESION_NO_CONECTADO` en vez de intentar un TCP
  condenado a colgar 4 segundos.

El agente se autentica con un token opaco de sucursal (no un JWT de usuario — es
infraestructura, no una cuenta humana), generado y rotado desde el panel por ADMIN
(`/api/agentes-impresion`, tabla `AgenteImpresion`, token guardado hasheado igual que
`RefreshToken`).

**Generación ESC/POS**: `src/modules/comanderas/escpos.ts`, a mano y sin dependencia nueva.
Code page CP850 para los acentos, con tabla de fallback a ASCII para lo no mapeado
(preferible "lena" a un byte basura que la impresora dibuje como símbolo). Si en el
hardware real salieran caracteres raros, se cambia la constante `CODE_PAGE_CP850` y la
tabla `MAPA_CP850`: **es el único lugar a tocar**.

> **Supuesto pendiente de confirmar con Ariel/Pablo**: se asumió que la comandera de
> MOSTRADOR imprime una **copia idéntica** a la de COCINA. Si quieren un formato distinto,
> hay que rediseñar el contenido — pero **en ningún caso** puede incluir montos.

#### Token de idempotencia

`Pedido.tokenIdempotencia` es un `String @unique` generado en el frontend por cada carrito
nuevo. Permite reintentos seguros de `POST /pedidos` sin duplicar. Si el backend ya procesó
ese token, devuelve el pedido existente (y **no reimprime** la comanda).

---

### FLUJO 5 — Caja y turnos

#### Apertura de turno

**Paso 1 — Login.** Sin turno abierto para su sucursal, el cajero no puede hacer nada (ni
ver el POS) hasta abrirlo.

> El gate de turno aplica **solo a la pestaña Caja**. Recibir transferencias NO exige turno
> abierto: la mercadería llega aunque la caja no haya abierto, son circuitos distintos.

**Paso 2 — Arqueo doble y ciego de apertura (INNEGOCIABLE).** El cajero hace DOS conteos
sin ver ningún número de referencia: cuenta el efectivo físico e ingresa el monto, cuenta
los pollos marcados e ingresa la cantidad. **La pantalla es completamente neutral**: solo
campos. Sin saldos anteriores, sin sugerencias, sin totales visibles.

**Paso 3 — Comparación interna.** El sistema compara contra:
- `saldoEsperadoEfectivo` = lo **contado** en el cierre del último turno CERRADO de la
  sucursal (0 si nunca hubo).
- `pollosMarcadosEsperados` = ídem para pollos. En el **primer** turno de una sucursal la
  referencia es el stock actual del producto MARCADO (0 en instalación fresca) — evita un
  bloqueo espurio si el sistema arranca con pollos ya en la parrilla.

El cálculo del faltante o sobrante lo hace **el sistema**, no lo carga el cajero.

**Si coinciden ambos** → turno `ABIERTO`.

**Si alguno no coincide** → turno `BLOQUEADO`.
- El cajero ve un mensaje genérico: *"Hay una diferencia en el conteo. Se notificó al
  administrador. Esperá la autorización para continuar."*
- **NO se muestra**: de cuánto es la diferencia, si es faltante o sobrante, nada
  financiero. (Sí se le dice **cuál** de los dos arqueos falló — ver §2.1.)
- Notificación por WebSocket **solo al ADMINISTRADOR** con: monto esperado, monto contado,
  diferencia, local, **cajero del cierre anterior** (para preguntarle a él primero) y
  cajero que está abriendo.

**Paso 4 — Desbloqueo (dos caminos).**

**Camino A — Remoto**: el admin ve la notificación en su panel con todos los datos y aprieta
"Desbloquear". Queda registrado quién autorizó, cuándo, con qué diferencia, y ambos
cajeros.

**Camino B — Clave de emergencia** (el admin no tiene acceso en ese momento):
- En la pantalla de bloqueo hay una opción **discreta, no obvia** (pequeña, en un rincón)
  para ingresar una clave.
- El admin la genera desde su panel: **8 caracteres aleatorios sin ambiguos** (se dictan
  por teléfono), **un solo uso**, **expira a los 10 minutos**, y **generar una nueva
  invalida la anterior**. Se muestra **una sola vez**.
- El admin se la dicta al cajero por teléfono.
- Una clave generada sin turno específico sirve para **cualquier turno bloqueado de
  cualquier sucursal** (comportamiento intencional para cuando el admin no tiene acceso al
  panel; el uso previsto es generarla desde la tarjeta del turno, que la ata a uno).
- Todo el evento queda registrado: quién la generó, quién la usó, con qué diferencia había,
  hora exacta.
- **Error genérico `CLAVE_INVALIDA` para todo fallo** (expirada, ya usada, incorrecta,
  cruzada de sucursal) — sin revelar el motivo. Una clave usada contra un turno que no
  corresponde **no se quema**.

#### Gestión del turno

El cajero puede:

- **Vender** (Flujo 4).
- **Marcar pollos** (`EventoMarcadoPollo`): *"tiré X pollos a la parrilla"*. Descuenta de
  fresco, suma a marcado, en la misma transacción atómica. Se puede hacer varias veces por
  turno.
- **Gastos de caja**: monto + medio (**solo `EFECTIVO` o `MERCADO_PAGO`**) + categoría de
  lista u "OTRO" con texto libre obligatorio. Categorías sugeridas: `PAPAS`,
  `LEÑA/CARBON`, `LIMPIEZA`, `BEBIDAS`, `VERDULERIA`, `CONDIMENTOS`, `OTRO`.
- **Retiros parciales**: monto + medio + quién retiró. **Selector CERRADO** con exactamente
  3 opciones: `ARIEL`, `ELIANA`, `EMA`. No es texto libre, no hay cuarta opción — validado
  por enum en DB y por Zod. El cajero registra el retiro pero **no ve el total retirado**.

#### Cierre de turno

**Paso 1**: el cajero selecciona "Cerrar turno".

**Paso 2 — Arqueo doble y ciego de cierre.** Igual que en apertura, sin ver referencias.

**El cierre NUNCA bloquea**, aunque haya discrepancia. La diferencia queda en el `Arqueo`
de cierre y en el resumen del admin (con alerta `DISCREPANCIA_CAJA`) — pero el cajero
cierra igual. **El bloqueo es solo en apertura.**

**Paso 3 — El sistema cruza todo internamente.**

```
Saldo final esperado de efectivo =
    valor contado en la apertura
  + SUM(Pago.EFECTIVO)                    [pagos netos de vuelto]
  − SUM(GastoDeCaja.monto WHERE medio = EFECTIVO)
  − SUM(RetiroDeCaja.monto WHERE medio = EFECTIVO)

Pollos marcados esperados al cierre =
    conteo de apertura
  + SUM(EventoMarcadoPollo.cantidad)
  − ventas de pollo entero
  − ventas de medio pollo × 0,5
  − pollos retornados a producción
  − pollos desperdiciados
```

> En la implementación, los pollos esperados salen del **neto de `MovimientoStock` del
> producto MARCADO durante el turno** — una sola fuente de verdad, no se recuentan eventos.

**Paso 4 — Qué ve cada rol.**

**El CAJERO VE (y SOLO esto):**
- Resumen de ventas **por unidad, sin montos de dinero**: cuántos pollos enteros, cuántos
  medios, cuántas milanesas.
- Conteo final de pollos marcados (el saldo que pasa al turno siguiente).
- Mensaje de confirmación.

**El CAJERO NO VE NUNCA**: el total vendido en pesos, la diferencia de caja, el faltante o
sobrante, los montos de retiros ni de gastos. Nada financiero.

**El ADMINISTRADOR y los SOCIOS VEN** (en sus reportes): resumen financiero completo —
ventas por medio, gastos, retiros por socio, atenciones, mermas, diferencia de caja.

**Paso 5**: el turno queda `CERRADO` y **la sesión del cajero se cierra automáticamente**.
Los saldos finales quedan como referencia para el arqueo de apertura siguiente.

---

### FLUJO 6 — Alertas de stock mínimo

**Se dispara automáticamente** en cada movimiento que reduce stock.

- **Configuración**: `ConfiguracionStockMinimo` por producto **y** sucursal. Solo
  ADMINISTRADOR configura. Un producto sin mínimo configurado no genera alertas.
- **"Bajo el mínimo" = estrictamente menor.** Quedar exacto en el mínimo no avisa.
- **Alerta repetida bajo el mínimo**: cada venta que deja el stock bajo el mínimo → pop-up
  en el POS, y **se repite en CADA venta siguiente** mientras siga bajo. No bloquea
  mientras haya stock > 0. Pedido explícito del cliente: *"que le seque la cabeza al
  cajero"*.
- **Bloqueo real en CERO**: si el stock es exactamente 0, el sistema **NO permite
  venderlo**. No es una alerta — es un bloqueo real, garantizado por la validación de stock
  (que nunca permite negativo).
- **Notificación al ADMINISTRADOR** solo **al cruzar** el umbral (antes ≥ mínimo, después <
  mínimo), no en cada venta posterior. Se crea dentro de la **misma transacción** del
  movimiento de stock.
- **Desactivación automática**: cuando el stock vuelve a superar el mínimo (por una
  transferencia recibida), la alerta se apaga sola. Volver a cruzar genera una alerta nueva.
- **Con combos**: la evaluación verifica los **componentes**, no el combo (los combos no
  tienen stock propio).

---

### FLUJO 7 — Auditoría y trazabilidad

Corre en paralelo con todos los flujos, siempre. Sin acción del usuario y **sin posibilidad
de editar ni borrar registros** (no existen rutas de UPDATE ni DELETE sobre `/auditoria` —
verificado por test).

**Cada `RegistroAuditoria` contiene siempre**: `accion`, `entidad`, `entidadId`,
`usuarioId`, `fechaHora` (UTC), `datosAnteriores` (JSON) y `datosNuevos` (JSON).

**Acciones que se registran** (el backend emite 48 distintas):

*Producción*: `REGISTRAR_INGRESO_MERCADERIA`, `ABRIR_LOTE_PRODUCCION`,
`CERRAR_LOTE_PRODUCCION`, `CREAR_VERSION_FICHA_TECNICA`, `GENERAR_TRANSFERENCIA`,
`CONFIRMAR_TRANSFERENCIA`, `CONFIRMAR_TRANSFERENCIA_CON_DISCREPANCIA`,
`CONTEO_RECEPCION_NO_COINCIDE`, `RECEPCION_RESUELTA_RECONTANDO`,
`REGISTRAR_RETORNO_PRODUCCION`

*Ventas*: `CONFIRMAR_PEDIDO` (snapshot completo), `MODIFICAR_PEDIDO` (anterior + nuevo),
`ANULAR_PEDIDO` (**pedido COMPLETO tal como estaba** — regla explícita del cliente),
`COBRAR_PEDIDO` (incluye bruto y vuelto), `ENTREGAR_SIN_COBRO`, `MARCAR_PEDIDO_LISTO`,
`PEDIDO_NO_RETIRADO`, `REASIGNAR_PEDIDO`, `MARCAR_PEDIDO_PERDIDO`, `REGISTRAR_ATENCION`,
`VENTA_COSTO_CERO`

*Caja*: `ABRIR_TURNO`, `CERRAR_TURNO`, `BLOQUEO_TURNO` (cajero anterior + actual +
diferencias), `DESBLOQUEO_TURNO_REMOTO`, `DESBLOQUEO_TURNO_CLAVE`,
`GENERAR_CLAVE_EMERGENCIA`, `REGISTRAR_GASTO_CAJA`, `REGISTRAR_RETIRO_CAJA` (con cuál
socio), `MARCAR_POLLOS`

*Administración*: `CREAR_USUARIO`, `ACTUALIZAR_USUARIO`, `CAMBIO_PRECIO` (anterior + nuevo
+ quién + cuándo), `CONFIGURAR_STOCK_MINIMO`, `ACTUALIZAR_CONFIGURACION`,
`CREAR_RECARGO_TARJETA`, `ACTUALIZAR_RECARGO_TARJETA`, `MODIFICAR_CONFIGURACION_COMANDERA`

> **Nota de nomenclatura**: el nombre real de algunas acciones difiere de cómo se las
> nombró en borradores viejos — el código emite `ACTUALIZAR_USUARIO` (no
> `MODIFICAR_USUARIO`) y `CONFIGURAR_STOCK_MINIMO` (no `MODIFICAR_STOCK_MINIMO`). Además
> `CONFIRMAR_TRANSFERENCIA` sale de una expresión ternaria en
> `transferencias.service.ts`, así que un grep ingenuo no la encuentra — está.

**Consulta**: ADMIN y SOCIO, con filtros por fecha, usuario, tipo de acción, módulo y
sucursal. Historial permanente. El "ver detalle" del frontend muestra **pares campo/valor
legibles** (resolviendo los `xxxId` a nombres reales) y traduce cada acción a una frase en
español — no JSON crudo.

**La cadena de trazabilidad completa** (el corazón del sistema):

```
Proveedor → IngresoMercaderia → LineaIngreso → InsumoUsado
         → LoteDeProduccion → MovimientoStock (PRODUCCION_ALTA)
         → Transferencia → LineaDeTransferencia (con loteOrigenId)
         → MovimientoStock (TRANSFERENCIA_ENTRADA) en el local
         → ItemDePedido → Pedido → cliente
```

Debe poder responderse: *"esta milanesa vendida el viernes salió de la entrega de nalga del
proveedor X del 3/7, producida por el operario Y en el lote Z con la versión 2 de la
receta."*

**Implementado**: `GET /api/reportes/trazabilidad/pedido/:id` (ADMIN + SOCIO) reconstruye
la cadena para cada ítem del pedido. El envío de transferencias permite elegir de qué
partida sale cada producto, con lo que el último eslabón dejó de inferirse por fecha.

---

## 6. MODELO DE DATOS

> **La fuente de verdad es [`prisma/schema.prisma`](prisma/schema.prisma).** Esta sección
> describe las decisiones y los invariantes; el archivo describe la forma exacta. Si hay
> diferencia, **gana el schema**. Antes de escribir una query o una migración, leé el
> modelo real.

### Convenciones

- IDs: `Int @default(autoincrement())` en **todos** los modelos.
- Fechas: **UTC en DB**, zona `America/Argentina/Cordoba` en presentación.
- Moneda: `Decimal @db.Decimal(12,2)`. Cantidades/stock: `Decimal @db.Decimal(12,3)`.
- Nombres de tabla en snake_case vía `@@map`, nombres de modelo en PascalCase.

### La entidad central

**`MovimientoStock` es la fuente de verdad del stock.** No hay tabla de saldos:

```
stock actual = SUM(MovimientoStock.cantidad) por (productoId, sucursalId)
```

`cantidad` es positiva (entra) o negativa (sale). `tipoOrigen` + `origenId` son una
referencia polimórfica al documento que lo causó.

### Invariantes que el schema garantiza (constraints, no solo código)

| Constraint | Qué evita |
|---|---|
| `uq_una_version_activa_por_ficha` (índice único parcial `WHERE activa = true`) | Dos versiones activas de la misma ficha técnica |
| `uq_un_turno_activo_por_sucursal` (único parcial `WHERE estado IN ('ABIERTO','BLOQUEADO')`) | Dos turnos activos en la misma sucursal (las ventas se repartirían entre ambos y el arqueo nunca cuadraría) |
| `@@unique([turnoId, momento, tipo])` en `Arqueo` | Dos cierres de turno concurrentes. **No es decorativo — no lo saques.** |
| `tokenIdempotencia @unique` en `Pedido`, `GastoDeCaja`, `RetiroDeCaja`, `EventoMarcadoPollo`, `Atencion` | Que un reintento de red duplique la operación |
| `@@unique([sucursalId, destino])` en `ConfiguracionComandera` | Dos comanderas de COCINA en el mismo local |
| `@@unique([productoId, sucursalId])` en `ConfiguracionStockMinimo` | Dos mínimos para el mismo producto+local |
| `@@unique([transferenciaId, productoId, loteOrigenId])` | Líneas redundantes (ojo: Postgres considera los NULL distintos entre sí, así que no impide dos líneas sin lote — inofensivo) |

### Campos ciegos — nunca serializar al rol equivocado

| Modelo | Campos | Prohibido para |
|---|---|---|
| `LoteDeProduccion` | `unidadesEsperadas`, `desvioPct`, `alertaDisparada` | PRODUCCION |
| `LineaDeTransferencia` | `cantidadEnviada`, `diferencia` | el receptor |
| `Arqueo` | `valorEsperado`, `diferencia` | CAJERO, ENCARGADO |

### Productos y proveedores de sistema

- `Producto.esProductoSistema` → *"Pollo a la leña (entero) — MARCADO"*. No se renombra ni
  se desactiva (`PRODUCTO_RESERVADO_SISTEMA`).
- `Proveedor.esProveedorSistema` → *"Retorno interno"*. No aparece en `GET /proveedores`,
  no se renombra ni se desactiva (`PROVEEDOR_RESERVADO_SISTEMA`).

---

## 7. RBAC — PERMISOS POR ENDPOINT

> **Esta tabla refleja el código real** (extraída de los `requerirRoles` de cada
> `*.routes.ts`), no un diseño aspiracional. Donde el código difiere de borradores
> anteriores, está marcado.

| Endpoint | ADMIN | SOCIO | ENCARGADO | CAJERO | PRODUCCION |
|---|---|---|---|---|---|
| **AUTH** — `/api/auth` |||||
| `POST /login`, `/refresh`, `/logout` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **USUARIOS** — `/api/usuarios` |||||
| Todo (GET/POST/PUT/DELETE) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **PRODUCTOS** — `/api/productos` |||||
| `GET /` (catálogo) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST/PUT/DELETE /` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /precios-vigentes` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GET /:id/precios` (historial) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /:id/precios` | ✅ | ❌ | ❌ | ❌ | ❌ |
| Combos (CRUD) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **PROVEEDORES** — `/api/proveedores` |||||
| `GET /` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `POST/PUT/DELETE /` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **FICHAS TÉCNICAS** — `/api/fichas-tecnicas` |||||
| `GET /` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /` (nueva versión) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **INGRESOS** — `/api/ingresos` |||||
| `POST /`, `POST /foto` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `GET /` | ✅ | ✅ | ✅ | ❌ | ✅ |
| **PRODUCCIÓN** — `/api/produccion` |||||
| `POST /lotes`, `PATCH /lotes/:id/cerrar` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `GET /lotes`, `/productos-producibles` | ✅ | ✅ | ❌ | ❌ | ✅ |
| **TRANSFERENCIAS** — `/api/transferencias` |||||
| `POST /` (generar) | ✅ | ❌ | ❌ | ❌ | ✅ |
| `POST /:id/recepcionar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /:id/confirmar-discrepancia` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **STOCK** — `/api/stock` |||||
| `GET /` | ✅ | ✅ | ✅ | ❌ ⚠️ | ✅ |
| `GET /movimientos` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **TURNOS** — `/api/turnos`, `/api/claves-emergencia` |||||
| `POST /abrir`, `/cerrar`, `GET /activo` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `GET /` (historial), `GET /:id/resumen` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /:id/desbloquear`, `POST /claves-emergencia` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /claves-emergencia/usar` | ✅ | ❌ | ✅ | ✅ | ❌ |
| **PEDIDOS** — `/api/pedidos` |||||
| Todo (crear, modificar, cobrar, anular, estados, listados) | ✅ | ❌ | ✅ | ✅ | ❌ |
| **CAJA** — `/api/{atenciones,gastos-caja,retiros-caja,marcado-pollos,costo-cero}` |||||
| Todo | ✅ | ❌ | ✅ | ✅ | ❌ |
| **COMANDERAS** — `/api/configuracion-comandera` |||||
| CRUD, `POST /:id/probar`, `GET /tickets/:pedidoId` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /tickets/:ticketId/reimprimir` | ✅ | ❌ | ✅ | ✅ | ❌ |
| **AGENTE DE IMPRESIÓN** — `/api/agentes-impresion` |||||
| `GET /`, `POST /` (generar/rotar token) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **RECARGOS** — `/api/recargos-tarjeta` |||||
| `GET /` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `POST/PATCH /` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **CONFIGURACIÓN** — `/api/configuracion` |||||
| `GET /` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `PATCH /` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **ALERTAS** — `/api/alertas` |||||
| `GET /`, `PATCH /:id/vista` | ✅ | ❌ ⚠️ | ❌ | ❌ | ❌ |
| **STOCK MÍNIMO** — `/api/config-stock-minimo` |||||
| `GET /` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `POST /` (upsert: alta, edición y desactivar) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **AUDITORÍA** — `/api/auditoria` |||||
| `GET /` (no hay escritura, por diseño) | ✅ | ✅ | ❌ | ❌ | ❌ |
| **REPORTES Y DASHBOARD** — `/api/reportes`, `/api/dashboard` |||||
| `GET *` | ✅ | ✅ | ❌ | ❌ | ❌ |

**Regla de sucursal**: CAJERO y ENCARGADO solo operan en su `Usuario.sucursalId`. **El
backend valida contra la DB, nunca solo contra el JWT.** 403 si intenta otra sucursal.

**⚠️ Los dos ítems marcados son decisiones abiertas del cliente — ver §11.3.**

**Sobre comanderas**: la configuración de IP/puerto es exclusivamente de ADMINISTRADOR —
es infraestructura, no un dato de negocio que necesiten ver los socios. Los roles
operativos solo interactúan con el resultado (banner en el POS + botón de reimprimir).

---

## 8. WEBSOCKETS

Socket.io con **salas por sucursal**. La autenticación se verifica en el handshake y la
sucursal del usuario se relee **de la base**, nunca del JWT. Solo eventos **no ciegos** van
a la sala de sucursal.

| Evento | Sala / quién recibe | Cuándo |
|---|---|---|
| `alerta:nueva` | Admin | Cualquier alerta nueva |
| `alerta:stock_minimo` | Sala del local + Admin | El stock cruza el mínimo |
| `ticket:nuevo` / `ticket:actualizacion` / `ticket:anulacion` | Sala del local | Al confirmar / modificar / anular un pedido |
| `comandera:fallo` | Sala del local | Una comandera no imprimió (dice cuál) |
| `turno:bloqueado` | Admin | Discrepancia en apertura |
| `turno:desbloqueado` | POS del cajero bloqueado | Admin o clave desbloquea |
| `pedido:listo_no_retirado` | Admin | Pedido pendiente > 30 min (job cada 2 min) |

**Polling de respaldo**: turno activo cada 20 s, pedidos cada 30 s. Existe porque el
desbloqueo remoto no puede depender de que el socket esté vivo.

---

## 9. MAPA DEL CÓDIGO

```
prisma/
  schema.prisma          ← fuente de verdad del modelo
  migrations/            ← 20 migraciones
  seed.ts                ← catálogo real + usuarios de desarrollo

src/
  app.ts                 buildApp() — registra plugins, rutas y el error handler
  server.ts              arranque + Socket.io + job de pedidos no retirados
  config.ts              env vars, con abort en producción si falta un secreto
  lib/
    prisma.ts            cliente + OPCIONES_TX
    errores.ts           AppError + catálogo de códigos de negocio
    auditoria.ts         registrarAuditoria(tx, ...)
    almacenamiento.ts    subida a R2 (AWS SigV4 a mano, sin SDK)
    constantes.ts        nombres de productos de sistema, umbrales
  plugins/auth.ts        JWT verify + requerirRoles (RBAC)
  modules/
    auth/                login, refresh (cookie httpOnly), logout
    usuarios/            CRUD solo admin
    productos/           catálogo, combos, precios (historial, nunca se pisa)
    proveedores/
    sucursales/
    stock/               stock = SUM(MovimientoStock) + bloquearStock()
    ingresos/            Flujo 1
    fichas-tecnicas/     versionado
    produccion/          Flujo 2 — cálculo ciego + serializers ciegos
    transferencias/      Flujo 3 — recepción ciega, discrepancias
    turnos/              Flujo 5 — arqueo doble ciego, bloqueo, claves
    pedidos/             Flujo 4 — el núcleo del POS
    caja/                atenciones, gastos, retiros, marcado, costo cero
    stock-minimo/        Flujo 6
    comanderas/          ESC/POS sobre TCP + CRUD de impresoras + agente de impresión
                         (agente-impresion.service.ts, agente-impresion.routes.ts)
    recargos/            porcentajes de recargo de tarjeta
    configuracion/       clave-valor (descuento a empleado)
    alertas/             solo admin, in-app + WebSocket
    auditoria/           Flujo 7 — inmutable, solo lectura
    reportes/            8 reportes + trazabilidad por pedido
    dashboard/           KPIs

frontend/src/
  api/                   un archivo por dominio + client.ts + types.ts
  auth/                  AuthContext (token en memoria) + RutaProtegida
  components/ui/         TecladoNumerico, Selector, PantallaExito,
                         EncabezadoWizard, BannerSinConexion, ErrorDeCarga
  lib/                   formato.ts (es-AR), precios.ts (espejo del greedy),
                         idempotencia.ts, jwt.ts, useSocket.ts
  features/
    login/
    produccion/          rol PRODUCCION (celular): menú + wizards + lote abierto
    local/               CAJERO/ENCARGADO: POS, caja, recepción ciega, stock
    admin/               ADMIN/SOCIO: dashboard, reportes, catálogo, alertas,
                         stock, turnos, transferencias, fichas, auditoría, usuarios

agente-impresion/        proceso standalone (no forma parte del build del backend) que
                         corre en una PC de cada local — puente Railway ↔ LAN para las
                         comanderas, ver su README.md y CLAUDE.md §5 Flujo 4

tests/
  unit/                  lógica pura, corre sin DB
  integration/           contra polleria_test, requiere DATABASE_URL_TEST
```

### Piezas que conviene conocer antes de tocar el POS

- **`transicionarAtomico()`** (`pedidos.service.ts`): condiciona el cambio de estado al
  estado leído **dentro** de la transacción (`updateMany` con `where` de estado → row
  lock). Es lo que evita doble cobro, doble anulación y doble click. Está bien pensado y
  bien comentado — no lo simplifiques sin entenderlo.
- **`bloquearStock()`** (`stock.service.ts`): advisory lock por (producto, sucursal), que
  se toma **antes** de leer el saldo y se libera al commit. Vive **adentro** de
  `validarStockSuficiente` / `validarStockRequerido`, así que es imposible validar stock sin
  haberlo trabado — no depende de que alguien se acuerde de llamarlo. Las claves se piden
  **ordenadas** para que dos pedidos que tocan los mismos productos en distinto orden no se
  bloqueen mutuamente.
  > Detalle que costó encontrar: usa `$executeRaw`, **no** `$queryRaw`.
  > `pg_advisory_xact_lock` devuelve `void` y el deserializador de Prisma no sabe leer esa
  > columna: fallaba en silencio revirtiendo la transacción entera.
- **`conIdempotencia()`** (`caja.service.ts`): cubre tanto el reintento secuencial como la
  carrera pura contra el constraint único (`P2002` → recupera el registro ganador).

---

## 10. ESTADO ACTUAL

**Rama**: `main`. El Módulo 2 se unificó en `main` en el commit `b67f953`; la rama
`feature/modulo-2` ya no existe y `main` es superconjunto de todo.

**Verificado el 2026-08-13**: `npm test` → **317/317 tests en verde** (22 archivos, ~5m47s
contra Neon). `npx tsc --noEmit` limpio en backend y frontend.

| Módulo | Alcance | Estado |
|---|---|---|
| **1** | Producción + Stock + Transferencias | ✅ Completo y auditado |
| **2** | POS + Caja y Turnos | ✅ Completo y auditado |
| **3** | Reportes + Dashboard | ✅ Completo (no necesitó migración: los datos ya existían) |
| **Comanderas** | ESC/POS real por TCP, 2 por local | ✅ Implementado — **falta probarlo contra el hardware físico** |

### Reportes disponibles (`src/modules/reportes/`)

`ventasPorProducto`, `ventasPorMedioDePago`, `cierresDeCaja`, `retirosPorSocio`,
`mermasPorProducto`, `rendimientoProduccion`, `gastosPorCategoria`, `atencionesReporte`, y
`trazabilidadPedido`. Todos con filtros `desde` / `hasta` / `sucursalId`.

**Dashboard**: totalVentas, cantidadPedidos, ticketPromedio, ventasPorMedio, totalGastos,
totalRetiros, mermas, alertasPendientes, lotesConDesvío, cantidadAtenciones.

### Auditoría técnica del 2026-08-07 — 18 de 19 hallazgos cerrados

Una auditoría de concurrencia, manejo de errores, flujos end-to-end y capa visual encontró
19 hallazgos. **18 están arreglados y verificados ejecutando** (no solo compilando):

**Concurrencia**
- **C-1/C-2 (críticos)** · Dos ventas simultáneas del mismo producto dejaban el stock
  **negativo** (se vendieron 20 empanadas habiendo 10), y dos marcados en paralelo creaban
  pollos de la nada — esto último rompía el arqueo ciego, cargándole al cajero una
  diferencia que no cometió. **Arreglado** con `bloquearStock()` (advisory locks, §9).
- **C-3 (alto)** · Se podían abrir dos turnos activos en la misma sucursal. **Arreglado**
  con el índice único parcial `uq_un_turno_activo_por_sucursal`; el `P2002` se traduce a
  `TURNO_YA_ACTIVO`.
- **C-4 (alto)** · Las operaciones de caja no tenían idempotencia: un reintento tras un
  timeout duplicaba el gasto/retiro/marcado. **Arreglado** con `tokenIdempotencia` en las
  4 tablas + `conIdempotencia()`.
- **C-6** · N+1 en la ruta caliente. **Arreglado**: los precios de todo el pedido salen en
  una query, `crearMovimientos` usa `createMany`. El tiempo de confirmar ahora es **plano
  respecto de la cantidad de productos**.
- **C-7** · 48 FK sin índice (PostgreSQL no las crea solas). **Arreglados** los del camino
  caliente.
- **C-5, C-8, C-9** · Quedan documentados. C-9 se resolvió solo al serializar. C-5
  (modificar y cobrar en paralelo podría cobrar el total viejo) y C-8 (`desbloquearRemoto`
  sin condicionar el UPDATE al estado) son de baja probabilidad; el arreglo conocido es
  mover lecturas adentro de la transacción.

**Manejo de errores**
- **E-1 (alto)** · Los errores de Prisma caían al 500 genérico: cargar un producto con
  nombre repetido decía *"Error interno del servidor"*. **Arreglado** — `P2002` → 409
  `YA_EXISTE` nombrando el campo, `P2025` → 404, `P2003` → 409 `EN_USO`, y
  `PrismaClientInitializationError`/`P1001` → 503 `BASE_NO_DISPONIBLE` (importante con Neon
  suspendiendo el compute).
- **E-2** · Con la API caída, 9 de 12 pantallas del admin no decían nada. **Arreglado** con
  el componente `ErrorDeCarga` (con botón de reintentar, porque el caso típico es
  transitorio).
- **E-3** · Cuatro mutaciones fallaban en silencio, incluida **cambiar un precio**.
  **Arreglado**: las cuatro tienen `onError` visible.
- **E-4** · La subida a R2 no tenía timeout (`fetch` de Node no trae uno por defecto).
  **Arreglado** con `AbortSignal.timeout(15000)` y un mensaje accionable.
- **E-5** · No había forma de reimprimir un ticket. **Arreglado** (ver §5 Flujo 4).
- **E-6** · Seis acciones de auditoría sin frase en castellano. Sin tocar: caen a un
  fallback legible, es cosmético.

**Visual** — V-1 (pestañas cortadas a 375px), V-2 (`color-scheme: light`, para que el modo
oscuro del sistema no pinte de negro los campos de arqueo), V-3 (área táctil del badge de
alertas de 24 → 44px) y V-4 (el login decía "Módulo 1"): **los cuatro arreglados**.

**Lo que la auditoría verificó y está BIEN** (no hace falta revisarlo de nuevo):
aislamiento entre sucursales (10 pedidos en paralelo alternando locales, sin
interferencia), `transicionarAtomico`, idempotencia de `POST /pedidos`, los serializers
ciegos sobre el JSON crudo, validación Zod completa, la arquitectura de comanderas, el
cliente HTTP del frontend (**si el token vence a mitad de una operación, el carrito no se
pierde** — el reintento ocurre dentro de `apiFetch` sin tocar el estado de React), el
índice del chequeo de stock, `server.ts`, y cero desbordes responsive en 12 pantallas × 2
viewports.

---

## 11. PENDIENTES Y DECISIONES ABIERTAS

### 11.1 Bloqueantes antes de producción

| Pendiente | Por qué importa | Acción |
|---|---|---|
| **Instalar y correr el agente de impresión en una PC de cada local** | El backend corre en Railway (nube, ver `DEPLOY.md`) y **no tiene ninguna ruta de red hacia las IPs privadas de la LAN del local** (ej. `192.168.1.201`) — un `ping`/`Test-NetConnection` exitoso desde la PC del local no dice nada sobre si Railway puede llegar ahí. Sin esto, "Imprimir prueba" cuelga hasta el timeout y falla siempre, aunque la IP esté bien cargada. Hallado en la puesta en marcha del 23/8 | Generar el token desde Catálogo → Comanderas → Agente de impresión (solo ADMIN) y dejar corriendo `agente-impresion/` (ver su `README.md`) en una PC de cada local que quede siempre prendida. Un agente por sucursal — no por comandera |
| **Probar las comanderas contra una XP-V320N real** | El código de `escpos.ts` está listo y testeado pero, hasta que el agente de arriba esté corriendo, ningún byte llega físicamente a la impresora — así que sigue sin validarse contra hardware real | Con el agente corriendo, verificar acentos (code page CP850), corte de papel y ancho de 48 columnas. Único lugar a ajustar si hay que corregir algo: las constantes de `escpos.ts` |
| **Cargar las 4 IPs reales** | Sin esto los pedidos se registran pero no sale ticket | Pablo las carga desde Catálogo → Comanderas y valida cada una con "Imprimir prueba" (con el agente de esa sucursal ya conectado) |
| **Secrets y usuarios reales** | El seed de desarrollo crea usuarios con contraseñas conocidas | `JWT_SECRET`/`JWT_REFRESH_SECRET` nuevos y distintos entre sí, `DATABASE_URL` de prod. **NUNCA correr el seed de dev contra prod** — los datos de catálogo/fichas sí sirven, los usuarios no |
| **`ORIGENES_PERMITIDOS`** | El backend **no arranca** en producción sin esto | Cargar el dominio del frontend, sin barra final |
| **Variables de R2** | El backend **no arranca** en producción sin las 5 | Ver `DEPLOY.md` |
| **Región de Neon** | Es la causa dominante de los ~2 s por venta, y **no se arregla con código** | Backend y base tienen que estar en la misma región. Medido: p50 de 52 ms por round-trip; si quedan en continentes distintos, una venta pasa de 2,5 s a 6-7 s, que ya es inusable |

### 11.2 Pendientes que dependen del cliente

| Pendiente | Estado |
|---|---|
| **Mail de resumen al cerrar turno** | No implementado. No hay módulo de mail ni dependencia. Bloqueado: falta que el cliente defina destinatarios y formato |
| **Formato del ticket de MOSTRADOR** | Se asumió copia idéntica al de COCINA. Confirmar con Ariel/Pablo. Restricción dura: nunca puede llevar montos |
| **Modelado del medio pollo** | Confirmar qué pasa con la otra mitad cuando se vende un medio |
| **Bebidas sin precio fijo** | En reportes aparecen con precio 0. Definir si tienen precio variable o se cargan a mano |
| **Motivos de atención** | La lista (`MOTIVOS_ATENCION` en `frontend/src/api/caja.ts`) puede no reflejar el negocio real. Mostrar a Pablo y Ariel |
| **Peso real de una milanesa individual** | Puede generar alertas de desvío falsas. Repreguntar a Pablo |
| **Umbral de pedido no retirado (30 min)** | Es el default de la spec, sin confirmar |
| **Persona concreta para ENCARGADO** | Rol habilitado pero sin asignado |
| **Ícono PWA real** | Hoy es un SVG placeholder "L&C". Falta arte de marca (PNG 192 y 512) |

### 11.3 Dos decisiones de permisos esperando respuesta

Estas dos difieren entre un borrador de spec y el código. **No se tocó nada** — hay que
decidir cuál vale. Cada una es un cambio de una línea.

1. **¿Los SOCIOS deberían ver las alertas?**
   Hoy `GET /alertas` es **solo ADMINISTRADOR**. La tabla de roles dice *"ADMINISTRADOR…
   recibe TODAS las alertas"*, sin mencionar a los socios, y el control ciego apunta en esa
   dirección. Un borrador posterior las habilitaba para SOCIO.
   → *Pregunta para Pablo/Ariel*: ¿Ariel/Eliana/Ema quieren ver el listado de alertas
   (desvíos de producción, discrepancias de caja) en su panel de solo lectura?
   → Si sí: agregar `'SOCIO'` al `requerirRoles` de `alertas.routes.ts`.

2. **¿Los CAJEROS deberían ver el stock general?**
   Hoy `GET /stock` excluye a CAJERO. En el diseño original solo ENCARGADO tenía la pestaña
   "Stock"; el cajero opera el POS sin ver niveles crudos (si un producto llega a cero, el
   sistema bloquea la venta, que es el mecanismo que de verdad le importa).
   → *Pregunta para Pablo/Ariel*: ¿el cajero necesita ver el stock del local, o le alcanza
   con que el sistema bloquee la venta cuando algo se agota?
   → Si sí: una línea en `stock.routes.ts`.

### 11.4 Fuera de alcance de v1 (no arrancar)

| Tema | Nota |
|---|---|
| Plan de costeo Fases B y C | Futura funcionalidad de rentabilidad |
| Conciliación con Mercado Pago | Hoy se hace a mano; los datos ya están en `Pago` |
| Facturación ARCA/AFIP | Campos previstos en `Pedido` |
| Pedidos por WhatsApp | `canalOrigen` previsto en `Pedido` |

---

## 12. REGLAS DE IMPLEMENTACIÓN

1. **Backend primero, siempre.** Tests completos antes de tocar el frontend.
2. **Toda operación multi-tabla va en `$transaction` de Prisma.** Si algo falla, rollback
   completo.
3. **La auditoría se registra dentro de la misma transacción**, con
   `registrarAuditoria(tx, ...)`. Nunca triggers de DB.
4. **El control ciego es server-side**, con whitelist explícita (no blacklist). Verificar
   con tests que inspeccionan el **JSON crudo** de la respuesta HTTP.
5. **El stock nunca puede ser negativo.** Validación bloqueante en TODAS las operaciones
   que consumen stock, y siempre detrás de `bloquearStock()`.
6. **Errores de negocio con códigos claros**: `STOCK_INSUFICIENTE`,
   `FICHA_SIN_VERSION_ACTIVA`, `TRANSFERENCIA_YA_CONFIRMADA`, `LOTE_YA_CERRADO`,
   `PRODUCTO_RESERVADO_SISTEMA`, `PROVEEDOR_RESERVADO_SISTEMA`, `CLAVE_INVALIDA`,
   `TURNO_YA_ACTIVO`, `VUELTO_SIN_EFECTIVO`, `PAGO_INSUFICIENTE`… El `message` es lo que
   lee el operario y tiene que ser accionable; el detalle técnico va en
   `AppError.detalleTecnico`, que **se loguea pero nunca se manda** en la respuesta.
7. **Moneda como `Decimal`**, nunca `Float`.
8. **Fechas en UTC en DB**, `America/Argentina/Cordoba` en presentación.
9. **Código, comentarios y nombres de dominio en español.**
10. **IDs `Int @default(autoincrement())`** en todo el proyecto.
11. **Nunca editar una `FichaTecnicaVersion` existente.** Modificar receta = versión nueva
    + desactivar la anterior, en la misma transacción.
12. **Tests de RBAC**: al menos un endpoint por módulo con test que verifica 403 para cada
    rol que no debería tener acceso.
13. **Tests de no-filtración**: verificar sobre el JSON crudo que `unidadesEsperadas`,
    `desvioPct`, `cantidadEnviada`, `diferencia` y `valorEsperado` no aparecen en respuestas
    de roles incorrectos.
14. **La impresión de comandas nunca bloquea el negocio.** Se intenta contra todas las
    comanderas activas de la sucursal, cada intento se registra por separado, y un fallo de
    hardware NUNCA impide confirmar, modificar o anular. `TicketCocina.contenido` jamás
    incluye montos.
15. **La fuente de verdad del schema es `prisma/schema.prisma`.** Leé el modelo real antes
    de escribir una query o una migración.
16. **Después de traer cambios de schema** (`git pull`, `git am`), correr
    `npx prisma generate` **a mano** si el `postinstall` no corrió. Si no, el cliente de
    Prisma queda viejo y tira `Unknown argument <campo>` aunque la migración esté aplicada.
17. **`prisma migrate deploy` hay que correrlo DOS veces**: `neondb` (desarrollo) y
    `polleria_test` (tests) son bases distintas, cada una con su propio historial. Correrlo
    solo en dev deja los tests fallando con `The column X does not exist`, que **parece un
    bug del código y no lo es**. Para la de tests: apuntar `DATABASE_URL` a `polleria_test`,
    correr el deploy, y volver a limpiar la variable.
18. **Nunca pushear código que dependa de una migración sin haberla aplicado.** Si
    `migrate deploy` falla (credenciales, red), el push queda roto: el backend escribe
    contra tablas que no existen y la caja revienta al confirmar el primer pedido. Primero
    la migración, después el push.

### Qué testear (convención heredada y vigente)

**Unitarios** (lógica pura, sin DB): saldo esperado de efectivo y de pollos al cierre,
diferencia de arqueo, precio con tabla de volumen, vuelto en pago mixto, transiciones de
estado del pedido, generación ESC/POS y diff de cambios del ticket.

**Integración** (contra `polleria_test`): flujo completo de turno cuadrando al centavo;
apertura con discrepancia → bloqueo → desbloqueo remoto y por clave; anulación con
reposición y snapshot; reasignación sin doble descuento; combo descontando componentes;
circuito del pollo completo; RBAC por rol; aislamiento de sucursal; control ciego sobre
JSON crudo; stock mínimo (alerta al cruzar, bloqueo en cero); inmutabilidad de auditoría;
carreras y vectores de ataque.
