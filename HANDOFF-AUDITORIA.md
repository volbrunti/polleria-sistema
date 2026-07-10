# Handoff para auditoría — Backend Módulo 1 Pollería

> **ACTUALIZACIÓN 2026-07-10 — auditoría completada.** Veredicto: backend listo para continuar. Acciones aplicadas tras la revisión:
> - §4.8 ✅ resuelto — índice único parcial `uq_una_version_activa_por_ficha` agregado por migración (`prisma/migrations/20260710150000_...`), aplicado en ambas DBs, suite completa verde.
> - §4.7 ✅ resuelto — Ema agregada al seed.
> - §4.4 ✅ documentado — `esPrincipal` y la fórmula de rendimiento formalizados en CLAUDE.md §9 con nota de "confirmar contra Excel del cliente".
> - §4.2 y §4.3 ✅ documentados — agregados a CLAUDE.md §11 (pendientes): migrar fotos a S3/Cloudinary antes de producción; confirmar roles receptores con el cliente.
> - §4.1, §4.5, §4.6 — validados por el auditor, sin cambios.

**Propósito de este documento**: contexto completo para que otro chat/agente audite si el backend implementado respeta todas las reglas de negocio de `CLAUDE.md` (el archivo de especificación del proyecto, ubicado en la raíz del repo). Este documento NO reemplaza `CLAUDE.md` — léelo primero, es la fuente de verdad. Acá documento qué se construyó, cómo se mapea a cada regla, y — más importante — **qué decisiones tomé por mi cuenta que no estaban explícitas en la spec**, para que las revises con lupa.

---

## 1. Qué se implementó

Backend completo de los **Flujos 1, 2 y 3** de `CLAUDE.md` (Ingreso de mercadería, Producción, Transferencias), más toda la infraestructura transversal (auth, RBAC, auditoría, alertas, stock). Node + TypeScript + Fastify + Prisma + PostgreSQL (Neon). Sin frontend — solo API REST.

**Estado**: 65/65 tests pasando (14 unitarios + 51 integración). DB provisionada en Neon, migrada y seedeada.

## 2. Estructura de archivos

```
prisma/schema.prisma          — modelo de datos completo
prisma/seed.ts                — datos de ejemplo
src/
  app.ts                      — registro de rutas y middleware
  server.ts                   — arranque + Socket.io
  config.ts                   — env vars
  lib/
    prisma.ts                 — cliente + OPCIONES_TX (ver §5)
    errores.ts                — AppError + códigos de negocio
    auditoria.ts               — helper registrarAuditoria()
  plugins/auth.ts              — JWT verify + requerirRoles (RBAC)
  modules/
    auth/                     — login, refresh, logout
    usuarios/                 — CRUD (solo admin)
    productos/                — catálogo + precios (historial)
    proveedores/
    sucursales/
    stock/                    — stock = SUM(MovimientoStock)
    ingresos/                 — FLUJO 1
    fichas-tecnicas/          — versionado de recetas
    produccion/                — FLUJO 2 (+ produccion.calculos.ts, produccion.serializers.ts)
    transferencias/            — FLUJO 3 (+ transferencias.serializers.ts)
    auditoria/                — solo lectura
    alertas/                  — solo admin
tests/
  unit/                       — cálculos puros + serializers (control ciego)
  integration/                — flujo completo end-to-end, RBAC, no-filtración, auditoría
```

## 3. Mapeo regla por regla (CLAUDE.md → implementación)

### §1.3 Control ciego (invariante rector)
- Producción: `unidadesEsperadas`, `desvioPct`, `alertaDisparada` calculados en `produccion.service.ts` (funciones `abrirLote`/`cerrarLote`) pero filtrados en `produccion.serializers.ts::serializarLote()` — whitelist explícita, no blacklist. Rol PRODUCCION nunca los recibe.
- Transferencias: `cantidadEnviada`/`diferencia` filtrados en `transferencias.serializers.ts::serializarTransferencia()` — el receptor nunca los ve, ni antes ni después de confirmar (verificado en test, incluso en el caso "coincide=true").
- Comparación de recepción responde solo `{coincide: true|false}`, mensaje genérico `"Los números no coinciden..."` sin revelar diferencia ni lado del error (`transferencias.routes.ts`, constante `MENSAJE_NO_COINCIDE`).
- **Tests dedicados de seguridad**: `tests/unit/serializers.test.ts` (unitario) y `tests/integration/rbac-y-campos-ciegos.test.ts` (inspecciona el JSON crudo de la respuesta HTTP real, no solo el objeto en memoria).

### §2 Roles y permisos
- 5 roles en enum `Rol`. RBAC vía `app.requerirRoles(...)` en cada ruta.
- ADMINISTRADOR: acceso total, único que recibe alertas (`alertas.routes.ts` restringe a `ADMINISTRADOR` solamente).
- SOCIO: verifiqué que NINGÚN endpoint de escritura acepta rol SOCIO — solo GET en productos/precios, auditoría, transferencias (lectura general).
- CAJERO: sin acceso a `/fichas-tecnicas`, `/alertas`, `/auditoria`, `/productos/precios` (dato financiero), `/stock/movimientos`. Sí puede recepcionar transferencias.
- PRODUCCION: sin acceso a `/fichas-tecnicas` (contienen rendimiento esperado — ni lectura), `/alertas`, `/auditoria`, historial de precios.
- ENCARGADO: rol sin persona asignada (CLAUDE.md §11 lo marca pendiente) — lo dejé habilitado para recepción de transferencias como "usuario del local", asumiendo que puede ser cajero o encargado indistintamente. **Ver §4.3 — decisión no explícita en la spec.**

### §3 Stack y decisiones de arquitectura
- Fastify + Prisma + PostgreSQL + Socket.io + JWT custom + Zod: todo como se pidió.
- JWT custom (no Auth0/Clerk/etc.) con access token + refresh token rotativo en cookie httpOnly (`auth.service.ts`, `auth.routes.ts`).
- Multi-sucursal desde el día 1: toda tabla relevante tiene `sucursalId`. **Excepción/riesgo**: asumí que existe **una sola** sucursal de tipo `PRODUCCION` (`prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } })` en `ingresos.service.ts`, `produccion.service.ts`, `transferencias.service.ts`). Si el negocio llega a tener 2 plantas de producción, esto rompe. **Ver §4.1.**
- Sin offline, sin AFIP — correctamente fuera de alcance.

### §5 Flujo 1 — Ingreso de mercadería
- Proveedor de lista + "Otro" con comentario obligatorio (`ingresos.service.ts::registrarIngreso`, valida `esOtro && !comentario` → error).
- Validación: proveedor obligatorio, ≥1 línea, cantidades > 0 (Zod schema en `ingresos.routes.ts`).
- Cada línea = `LineaIngreso` con `cantidadRestanteDisponible` — no se funde en pool genérico.
- Foto: endpoint `POST /ingresos/foto` sube a disco local (`uploads/remitos/`), no se procesa. **Ver §4.2 — riesgo de infraestructura.**
- Stock sube por `cantidadRealPesada`, no por remito. `MovimientoStock` tipo `INGRESO_COMPRA`.
- Todo en transacción + auditoría (`REGISTRAR_INGRESO_MERCADERIA`).

### §6 Flujo 2 — Producción
- `abrirLote`: elige líneas de ingreso específicas por insumo, valida stock bloqueante (nunca negativo) tanto contra `cantidadRestanteDisponible` de la línea como contra el stock agregado del producto.
- Ficha técnica congelada: `fichaTecnicaVersionId` se fija al abrir el lote, no cambia aunque se cree una versión nueva después.
- Cálculo de rendimiento esperado: **fórmula que inventé, no está en CLAUDE.md** (ver §4.4) — `produccion.calculos.ts::calcularUnidadesEsperadas`.
- Control ciego en apertura y cierre (nunca se expone al operario, ver serializers).
- Cierre atómico: descuenta insumos de sus líneas Y del stock (`CONSUMO_PRODUCCION`), registra desperdicio (`DESPERDICIO_PRODUCCION`) separado, da de alta lo producido (`PRODUCCION_ALTA`), calcula desvío, dispara `Alerta` tipo `DESVIO_PRODUCCION` si supera umbral — todo en una sola transacción Prisma.
- Fichas versionadas: `crearNuevaVersion` desactiva TODAS las versiones previas de esa ficha antes de crear la nueva (constraint "una sola activa" respetado a nivel de servicio, no de DB — **ver §4.5**).

### §7 Flujo 3 — Transferencias
- Generación: valida stock, descuenta origen (`TRANSFERENCIA_SALIDA`), estado `PENDIENTE_RECEPCION`, firma emisor.
- Recepción ciega: compara internamente, si coincide → `CONFIRMADA` + `TRANSFERENCIA_ENTRADA`; si no → responde sin persistir nada, receptor puede recontar sin límite (no hay tope de intentos, cada POST es independiente y stateless) o confirmar igual.
- Confirmar con discrepancia: stock del local = cantidad DECLARADA por receptor (no la enviada), estado `CONFIRMADA_CON_DISCREPANCIA`, alerta con ambos números + ambos usuarios.
- Nunca bloquea la operación por discrepancia — coincide con la spec.

### §9 Modelo de dominio
- Todas las entidades transversales y del módulo 1 están en `schema.prisma` tal como se listaron en CLAUDE.md §9, con los mismos nombres de campo (en español).
- `MovimientoStock` como entidad central, stock = `SUM(cantidad)`, no materializado en `StockActual` (la spec dice que es opcional — `stock.service.ts::obtenerStock` usa `aggregate` en cada consulta).
- Cadena de trazabilidad `LineaIngreso → InsumoUsado → LoteDeProduccion → LineaDeTransferencia` verificada explícitamente en test de integración (`tests/integration/flujo-completo.test.ts`, describe "Trazabilidad y auditoría de punta a punta").

### §10 Reglas de implementación
- Estructura por módulos `routes → controllers(routes) → services → repositories(Prisma directo)` — nota: no hay capa "controllers" separada, las rutas llaman servicios directamente (fusioné controller+route por simplicidad; **ver §4.6**).
- Zod en cada endpoint.
- RBAC en middleware (`app.requerirRoles`).
- Transacciones Prisma en: cierre de lote, generación/confirmación de transferencia, registro de ingreso, cambios de precio, creación de fichas — confirmado, ver `$transaction` en cada `.service.ts`.
- Auditoría en capa de servicio dentro de la misma transacción (`registrarAuditoria(tx, ...)`), nunca triggers de DB.
- Errores con códigos: `STOCK_INSUFICIENTE`, `FICHA_SIN_VERSION_ACTIVA`, `TRANSFERENCIA_YA_CONFIRMADA`, `LOTE_YA_CERRADO`, `NO_ENCONTRADO`, `CREDENCIALES_INVALIDAS`, `NO_AUTORIZADO`, `PROHIBIDO`, `VALIDACION`, y agregué `LINEA_INGRESO_INSUFICIENTE` (no estaba en la lista sugerida — extensión razonable, no contradice nada).
- Seeds: 3 sucursales, usuarios por rol, proveedores + Otro, catálogo, fichas de ejemplo — **con un hueco: solo sembré 2 de los 3 socios nombrados en CLAUDE.md §2 (Ariel, Eliana) — falta Ema.** Ver §4.7.
- Testing obligatorio: unitarios de lógica pura + integración con RBAC 403 + no-filtración de campos ciegos + inmutabilidad de auditoría — todo hecho, ver `tests/`.

### §12 Criterio de "módulo 1 terminado"
Repasé los 6 puntos del checklist uno por uno contra los tests de integración — los 6 están cubiertos por `tests/integration/flujo-completo.test.ts` y `tests/integration/rbac-y-campos-ciegos.test.ts`.

---

## 4. Decisiones no explícitas en CLAUDE.md — REVISAR CON CUIDADO

Estas son las partes donde tuve que inventar algo porque la spec no lo cerraba del todo. Es la lista prioritaria para que el auditor chequee contra la intención real del cliente.

### 4.1 Una sola sucursal de tipo PRODUCCION
Asumí que `sucursalOrigen` de ingresos/producción/transferencias es siempre la única sucursal con `tipo: 'PRODUCCION'` (`findFirst`). CLAUDE.md dice "el sistema debe escalar a más locales sin refactor" — pero eso lo interpreté como "más locales de VENTA", no como "más plantas de producción". Si el negocio pudiera tener más de una planta, esto necesita cambiar a selección explícita de sucursal origen.

### 4.2 Foto de remito guardada en disco local
`POST /ingresos/foto` escribe a `uploads/remitos/` en el filesystem del servidor. CLAUDE.md dice "adjunta opcional... el sistema NO la procesa" pero no especifica dónde se guarda. **Riesgo real**: Railway (backend de producción según CLAUDE.md §3) tiene filesystem efímero — las fotos se pierden en cada redeploy. Esto va a necesitar S3/Cloudinary/similar antes de producción. No lo resolví porque no estaba en el alcance pedido, pero es un gap real que debería flagearse.

### 4.3 Quién recibe transferencias (CAJERO vs ENCARGADO)
CLAUDE.md Flujo 3 dice "Usuario del local (receptor)" sin especificar el rol exacto. Habilité tanto `CAJERO` como `ENCARGADO` (y `ADMINISTRADOR`) para el endpoint de recepción. Es una suposición razonable pero no confirmada con el cliente.

### 4.4 Fórmula de rendimiento esperado — INVENTADA, no está en la spec
CLAUDE.md dice que la ficha técnica tiene "rendimiento esperado" y "% desperdicio esperado" como campos, pero nunca da la fórmula exacta para combinarlos y calcular `unidadesEsperadas` a partir de la cantidad de insumo usada. Yo definí:

```
unidadesEsperadas = (cantidadInsumoPrincipal / cantidadPorUnidadProducida) × (1 − desperdicioEsperadoPct/100)
```

Para esto también agregué un campo `esPrincipal` en `IngredienteDeReceta` que **no está en el schema propuesto por CLAUDE.md §9** — lo necesité para saber cuál insumo es la "base" del cálculo de rendimiento (ej: la nalga en la milanesa, no el pan rallado ni el huevo). Esto es una decisión de diseño mía, no una regla de negocio validada con el cliente. **Es probablemente el punto más importante para que el auditor revise** — si la fórmula real que usa el cliente en su Excel es distinta, hay que rehacer `produccion.calculos.ts`.

### 4.5 Desperdicio real solo se resta del insumo principal
En `cerrarLote` (`produccion.service.ts`), el `desperdicioRealKg` que carga el operario se descuenta proporcionalmente SOLO de los movimientos de stock del insumo marcado como `esPrincipal`. Los demás insumos (pan rallado, huevo, condimentos) se consumen íntegros sin desperdicio propio. CLAUDE.md no aclara si el desperdicio es solo de la carne o de todos los insumos — asumí que es de la materia prima principal porque conceptualmente tiene más sentido (se tira recorte de carne, no huevo), pero no está confirmado.

### 4.6 Fusión de capas controller+route
CLAUDE.md pide `routes → controllers → services → repositories`. Implementé `routes → services → Prisma` directo, sin archivo `controller` separado (la lógica de parseo/respuesta vive en el mismo archivo de rutas). Es una simplificación arquitectónica, no afecta comportamiento, pero técnicamente no sigue la estructura de capas al pie de la letra.

### 4.7 Seed incompleto de socios
CLAUDE.md §2 nombra 3 socios: Ariel, Eliana, Ema. El seed (`prisma/seed.ts`) solo crea usuarios para Ariel y Eliana. Falta Ema. Bug menor, fácil de arreglar.

### 4.8 Constraint "una sola versión activa por ficha" no está a nivel de DB
CLAUDE.md dice "Constraint: una sola activa por ficha" en `FichaTecnicaVersion`. Lo garanticé a nivel de servicio (`crearNuevaVersion` hace `updateMany` desactivando todas antes de crear la nueva, dentro de la misma transacción), pero NO hay un constraint de base de datos (índice único parcial `WHERE activa = true`) que lo fuerce a nivel de schema. Si alguien escribe directo a la DB salteando el servicio, podría violarse. Debería agregarse un unique index parcial en Postgres para blindarlo del todo.

---

## 5. Bug técnico encontrado y arreglado (no de negocio, pero relevante)

Las transacciones Prisma con varios round-trips secuenciales (loops de insumos/líneas en `abrirLote`/`cerrarLote`/transferencias/ingresos) superaban el timeout default de Prisma (5s) contra la latencia de Neon y tiraban error 500 (`Transaction not found`). Fix: `src/lib/prisma.ts` exporta `OPCIONES_TX = { maxWait: 15000, timeout: 30000 }`, aplicado como segundo argumento a esos `$transaction(...)`. No afecta lógica de negocio, solo resiliencia de infraestructura.

## 6. Qué NO se implementó (correctamente fuera de alcance)

Todo lo de §8 de CLAUDE.md (Flujos 4-7 salvo la parte de auditoría transversal que sí nace en módulo 1): POS, caja/turnos, alertas de stock mínimo, reportes. Ninguno de estos se tocó — el modelo de datos no les cierra el paso pero no se construyó nada de esa lógica.

## 7. Cómo verificar

```powershell
npx tsc --noEmit     # typecheck limpio
npm test             # 65/65 tests — incluye los de RBAC y no-filtración de campos ciegos
```

Para revisión manual: `tests/integration/rbac-y-campos-ciegos.test.ts` tiene el listado explícito de qué rol NO puede acceder a qué endpoint (útil para chequear contra la tabla de roles de CLAUDE.md §2 línea por línea).
