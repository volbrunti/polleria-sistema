# PROMPT PARA DISEÑO DE FRONTEND — copiar y pegar completo

---

Necesito que diseñes el frontend del **Módulo 1 de un sistema de gestión para una pollería** en Córdoba, Argentina. El backend ya existe y está probado — tu trabajo es SOLO el diseño de las pantallas. Leé todo este documento antes de dibujar nada: las reglas de negocio son estrictas y hay campos que NUNCA pueden aparecer en ciertas pantallas (es una regla de seguridad del negocio, no estética).

## 1. CONTEXTO DEL NEGOCIO (lo mínimo que necesitás)

Pollería con 3 ubicaciones: una **planta de Producción** (transforma materia prima en unidades: milanesas, empanadas) y **2 locales de venta**. El sistema controla trazabilidad total: qué entró, qué se produjo, qué se transfirió a los locales.

**Principio rector — CONTROL CIEGO**: el empleado que cuenta algo NUNCA ve el valor esperado antes de contar. El sistema compara internamente. Si los números no coinciden, solo el Administrador se entera de la diferencia. Esto atraviesa todo el diseño: hay datos que un rol jamás debe ver en pantalla, ni en tooltips, ni en atributos HTML, ni en mensajes de error.

## 2. USUARIOS REALES — DISEÑAR PARA ELLOS

- Empleados de cocina/producción y cajeros de local. **No son usuarios técnicos.** Muchos van a usar el sistema con las manos ocupadas o sucias, apurados, con ruido alrededor.
- Requisito del dueño: "pensá que el usuario es tonto y tiene que usarlo rápido y fluido, sin confusiones".
- Reglas duras de UX:
  - **Botones enormes** (mínimo 56px de alto, texto 18px+), alto contraste.
  - **Una acción principal por pantalla.** Nada de dashboards con 15 opciones para el operario.
  - **Flujos lineales tipo wizard**: paso 1 → paso 2 → paso 3 → confirmación. Siempre visible en qué paso estás.
  - **Teclado numérico grande en pantalla** para cargar cantidades (estilo calculadora, no input chiquito de texto).
  - Confirmación visual fuerte al terminar cada operación (pantalla verde con check gigante, no un toast chiquito).
  - Errores en lenguaje simple: "No hay suficiente nalga. Tenés 5 kg y quisiste usar 9 kg." Nada de códigos técnicos.
  - Todo en **español rioplatense** (vos/tenés).
  - **El rol PRODUCCIÓN usa el sistema desde el CELULAR** (mobile-first estricto para sus pantallas). Los demás roles: tablet/PC.

## 3. STACK (ya decidido, no proponer otro)

React 18 + Vite + Tailwind CSS. PWA. El backend es una API REST con JWT (header `Authorization: Bearer <token>`). No diseñes lógica de backend — ya existe.

## 4. ROLES Y QUÉ PANTALLAS VE CADA UNO

Tras el login, el sistema detecta el rol y muestra SOLO las pantallas de ese rol. Un usuario jamás ve opciones de menú que no puede usar.

### 4.1 ROL: PRODUCCIÓN (celular, el más importante de diseñar bien)

Menú de 3 botones gigantes:

**A) "LLEGÓ MERCADERÍA" (Flujo 1 — registrar ingreso)**
Wizard:
1. Elegir proveedor de una lista de ~10 tarjetas grandes con nombre. Última opción: "OTRO" → abre campo de texto obligatorio "¿De dónde vino?".
2. Agregar productos uno por uno: elegir producto (buscador + lista de tarjetas), cargar DOS números con teclado numérico grande: "¿Cuánto dice el remito?" y "¿Cuánto pesaste vos?". Ambos obligatorios, > 0. Puede agregar N líneas; se ven como lista con opción de borrar antes de confirmar.
3. Opcional: botón "SACAR FOTO DEL REMITO" (cámara del celular). Se puede saltear.
4. Pantalla resumen → botón "CONFIRMAR INGRESO" → pantalla de éxito.
- API: `POST /api/ingresos` con `{proveedorId, comentarioProveedorOtro?, fotoRemitoUrl?, lineas: [{productoId, cantidadSegunRemito, cantidadRealPesada}]}`. Foto: `POST /api/ingresos/foto` (multipart) devuelve `{fotoRemitoUrl}`.

**B) "PRODUCIR" (Flujo 2 — lote de producción)**
Wizard:
1. Elegir qué va a producir (tarjetas: "Milanesa de nalga", "Empanada de pollo"...). API: `GET /api/productos?tipo=ELABORADO`.
2. Por cada insumo que use: elegir el producto insumo y DE QUÉ PARTIDA lo saca. El sistema muestra las partidas disponibles como tarjetas: "10 kg — llegó el 3/7 — Granja San José (quedan 8.2 kg)". API: `GET /api/ingresos/lineas-disponibles?productoId=X`. Cargar cantidad usada con teclado grande.
   - Si carga más de lo que hay → error inmediato en rojo, claro: "No alcanza. En esa partida quedan 8,2 kg." NO deja avanzar.
3. Resumen → "EMPEZAR PRODUCCIÓN" → crea el lote. API: `POST /api/produccion/lotes`.
4. El lote queda "ABIERTO". Pantalla del lote abierto con UN botón: "TERMINÉ — CARGAR RESULTADO".
5. Cargar DOS números: "¿Cuántas unidades salieron?" y "¿Cuántos kg tiraste (desperdicio)?". → "CERRAR LOTE" → pantalla de éxito. API: `POST /api/produccion/lotes/{id}/cerrar`.
- **REGLA CIEGA CRÍTICA**: esta pantalla JAMÁS muestra cuántas unidades "deberían" salir, ni rendimiento, ni desvío, ni si se disparó alerta. La API ya no envía esos campos para este rol — el diseño tampoco debe insinuarlos (nada de "esperado: —" ni espacios vacíos que delaten que existe el dato). Al cerrar el lote la pantalla de éxito dice solo "Lote cerrado. Se produjeron 40 milanesas." Sin valoración, sin comparación, sin colores de bien/mal.

**C) "ENVIAR A LOCAL" (Flujo 3 — generar transferencia)**
Wizard:
1. Elegir destino: 2 tarjetas gigantes ("LOCAL 1" / "LOCAL 2"). API: `GET /api/sucursales`.
2. Agregar productos y cantidad (en UNIDADES) con teclado grande. El sistema muestra el stock disponible de producción para ese producto. Si pone más de lo que hay → error claro, no avanza.
3. Resumen → "CONFIRMAR ENVÍO" → éxito con número de remito virtual. API: `POST /api/transferencias`.
- El emisor SÍ ve las cantidades que envió (es quien las cargó). Puede ver su historial de envíos y el estado (pendiente/confirmado).

### 4.2 ROL: CAJERO (tablet en el local)

Una sola función en módulo 1: **"RECIBIR MERCADERÍA" (recepción ciega de transferencias)**.
1. Lista de transferencias pendientes para su local: tarjetas con fecha, origen y QUÉ productos vienen — **PERO SIN CANTIDADES**. La API ya no envía `cantidadEnviada` a este rol. El diseño no debe dejar hueco visual que sugiera que falta un dato: la tarjeta muestra solo "Milanesa de nalga" sin campo de cantidad.
2. Al abrir una: por cada producto, "Contá y cargá cuántas unidades llegaron" con teclado numérico gigante.
3. Botón "CONFIRMAR CONTEO". API: `POST /api/transferencias/{id}/recepcion` con `{lineas: [{productoId, cantidadRecibida}]}`.
4. Dos respuestas posibles:
   - `{coincide: true}` → pantalla verde: "✓ Todo en orden. Mercadería ingresada."
   - `{coincide: false}` → pantalla NEUTRAL (ni roja ni alarmante, no culpabilizar) con el mensaje EXACTO: "Los números no coinciden." y DOS botones grandes: **"VOLVER A CONTAR"** (repite el paso 2, sin límite de intentos) y **"CONFIRMAR IGUAL"** (con sub-texto "Se registrará tu conteo"). Confirmar igual llama a `POST /api/transferencias/{id}/confirmar-con-discrepancia`.
   - **REGLA CIEGA CRÍTICA**: esta pantalla JAMÁS muestra cuánto se envió, cuál es la diferencia, ni de qué lado está el error. Ni antes, ni durante, ni después de confirmar. El historial del cajero muestra solo lo que ÉL declaró.

### 4.3 ROL: ADMINISTRADOR (PC/tablet — el único con visión completa)

Dashboard con navegación lateral:
- **Alertas** (pantalla principal): lista de alertas con badge de no-vistas. Dos tipos en módulo 1: "Desvío de producción" (muestra: producto, lote, operario, unidades esperadas vs. reales, % desvío, desperdicio) y "Discrepancia en transferencia" (muestra: producto, cantidad enviada, cantidad recibida, diferencia, quién envió, quién recibió, fecha/hora). Marcar como vista. API: `GET /api/alertas`, `PATCH /api/alertas/{id}/vista`. Llegan también en tiempo real por WebSocket (badge se actualiza solo).
- **Stock**: tabla por sucursal (selector arriba: Producción / Local 1 / Local 2), producto, cantidad, unidad. API: `GET /api/stock?sucursalId=X`. Vista de movimientos con filtros (producto, sucursal, fechas): `GET /api/stock/movimientos`.
- **Producción**: lista de lotes con TODO visible (esperado, real, desvío % con color rojo si superó umbral, operario, ficha versión). Detalle de lote: insumos usados y de qué partida salieron (trazabilidad).
- **Transferencias**: lista completa con cantidades enviadas Y recibidas, diferencias, ambas firmas, estados.
- **Fichas técnicas**: ver fichas con versiones e ingredientes; crear ficha nueva y crear nueva versión (formulario: rendimiento esperado, % desperdicio esperado, umbral de alerta %, ingredientes con cantidad por unidad y cuál es el principal — exactamente uno). Aclarar en la UI que crear versión nueva desactiva la anterior.
- **Catálogo**: CRUD de productos (nombre, categoría, tipo MATERIA_PRIMA/ELABORADO/REVENTA, unidad KG/UNIDAD), precios (cambiar precio = registro nuevo, mostrar historial), proveedores, sucursales.
- **Usuarios**: CRUD (nombre, username, password, rol, activo).
- **Auditoría**: tabla con filtros (fecha, usuario, acción, entidad). Solo lectura. API: `GET /api/auditoria`.

### 4.4 ROL: SOCIO (PC/tablet — SOLO LECTURA)

Mismo layout que Admin pero: sin Alertas, sin Usuarios, sin ningún botón de crear/editar/borrar en ninguna pantalla. Ve: Stock, Producción (completa, con esperados y desvíos), Transferencias (completa), Fichas técnicas (solo ver), Catálogo (solo ver), Auditoría. Ni un solo control de escritura visible.

### 4.5 ROL: ENCARGADO

Igual que CAJERO en módulo 1 (solo recepción de transferencias) + puede ver Stock de su local. Sin datos financieros (sin precios), sin alertas, sin auditoría.

## 5. PANTALLA DE LOGIN (todos los roles)

Simple: usuario + contraseña, botón gigante "ENTRAR". Error genérico "Usuario o contraseña incorrectos" (nunca distinguir cuál falló). Tras login, redirección automática a la pantalla principal del rol. API: `POST /api/auth/login` → `{accessToken, usuario: {nombre, rol}}`. Mostrar siempre arriba quién está logueado ("Hola, Juan — Producción") y botón de salir visible: cada acción queda firmada por el usuario logueado, compartir usuario está prohibido por regla del negocio.

## 6. ESTADOS Y ERRORES QUE EL DISEÑO DEBE CONTEMPLAR

- **Sin conexión**: banner rojo fijo "Sin conexión — los datos no se están guardando" (no hay modo offline; el fallback del negocio es papel).
- **Cargando**: spinners/skeletons en cada fetch; botones deshabilitados con spinner mientras se envía (evitar doble-submit — crítico: doble tap = ingreso duplicado).
- **Errores de la API** (vienen como `{codigo, mensaje}`): traducir a lenguaje simple. Los importantes: `STOCK_INSUFICIENTE` y `LINEA_INGRESO_INSUFICIENTE` (mostrar el mensaje, que ya incluye cantidades disponibles/requeridas), `TRANSFERENCIA_YA_CONFIRMADA` ("Esta entrega ya fue confirmada por otra persona"), `LOTE_YA_CERRADO`, `VALIDACION` (mostrar qué campo falta), sesión vencida → volver a login sin perder lo tipeado si es posible.
- **Listas vacías**: mensajes amables con ilustración ("Todavía no llegó mercadería hoy").

## 7. QUÉ NO DISEÑAR (fuera de alcance)

Nada de POS/ventas, caja, turnos, arqueos, pedidos, comandera, reportes con gráficos. Eso es módulo 2/3. Solo lo listado arriba.

## 8. ENTREGABLE QUE TE PIDO

1. Sistema de diseño mínimo: paleta (alto contraste, apta para cocina con luz fuerte), tipografía grande, componentes base (botón gigante, tarjeta seleccionable, teclado numérico, stepper de wizard, tarjeta de alerta, tabla admin).
2. Mockups de TODAS las pantallas listadas, priorizando en este orden: (1) los 3 wizards de PRODUCCIÓN en mobile, (2) recepción ciega de CAJERO en tablet, (3) dashboard de ADMINISTRADOR, (4) login, (5) SOCIO/ENCARGADO (variantes de lo anterior).
3. Los dos flujos ciegos mostrados pantalla por pantalla, incluyendo los estados de error y el camino "no coincide → recontar / confirmar igual".
4. Indicá en cada pantalla qué endpoint consume.

**Checklist final antes de entregar** (verificá cada punto):
- [ ] Ninguna pantalla de PRODUCCIÓN muestra unidades esperadas, rendimiento, desvío o alerta.
- [ ] Ninguna pantalla de CAJERO/ENCARGADO muestra cantidad enviada ni diferencia, en ningún estado.
- [ ] La pantalla "no coincide" es neutral, sin números, con exactamente 2 salidas.
- [ ] Todo botón de acción principal ≥56px de alto.
- [ ] Cantidades siempre se cargan con teclado numérico grande en pantalla.
- [ ] SOCIO no tiene ni un control de escritura visible.
- [ ] Cada rol ve solo su menú.
- [ ] Textos en español rioplatense, sin jerga técnica.
