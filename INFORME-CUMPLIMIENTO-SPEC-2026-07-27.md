# Informe de cumplimiento — Sistema vs. documento maestro (CLAUDE.md final)

> **Contexto**: Facundo pasó un documento maestro consolidado ("CLAUDE.md — Documento
> Maestro del Sistema") con las reglas de negocio validadas con Pablo, Ariel y Eliana.
> Este informe cruza ese documento, ítem por ítem, contra el código real de la rama
> `feature/modulo-2` (commit `694151e` en adelante) — schema, rutas, servicios y tests.
> **Objetivo**: que Facundo lo valide con Pablo/Ariel antes de tocar nada de RBAC.
>
> **Nada de lo que dice "requiere decisión" fue cambiado todavía.** Lo único que se
> hizo en paralelo a este informe fue cerrar el único gap que el propio documento
> admitía sin ambigüedad (tests de reportes/dashboard) — ver sección 4.

---

## 1. Resumen ejecutivo

| | |
|---|---|
| Ítems revisados | Los 12 capítulos del documento (roles, stack, 7 flujos de negocio, schema completo, tabla RBAC de 40+ endpoints, WebSockets, estado del proyecto, pendientes) |
| Cumple sin observaciones | La gran mayoría — control ciego, los 7 flujos, convenciones de schema, transacciones atómicas, versionado de fichas, circuito del pollo |
| Requiere decisión de Pablo/Ariel | 2 puntos de permisos (RBAC) — sección 2 |
| Documentación desactualizada (no es un bug) | 5 puntos donde el documento dice "pendiente" pero el sistema ya lo resolvió — sección 3 |
| Gaps reales confirmados | Tests de reportes/dashboard (**ya resuelto hoy**, ver sección 4) + los pendientes menores que el propio documento ya reconocía (bebidas sin precio fijo, fotos de remito en disco, motivos de atención sin validar, peso de milanesa individual) |

**Conclusión corta**: el sistema no tiene ninguna regla de negocio incumplida de las que Pablo/Ariel validaron originalmente. Las únicas diferencias reales son 2 permisos donde este documento nuevo pide algo que el diseño original (validado en su momento) hacía distinto — hay que decidir cuál de los dos vale.

---

## 2. Requiere decisión — no se tocó el código todavía

### 2.1 ¿Los SOCIOS deberían ver las alertas?

- **Documento nuevo dice**: `GET /alertas` → ADMIN ✅ y SOCIO ✅.
- **Código actual**: `GET /alertas` → **solo ADMINISTRADOR**.
- **Por qué está así**: el CLAUDE.md raíz (el que sí validaron en su momento) dice literal en la tabla de roles: *"ADMINISTRADOR ... Recibe TODAS las alertas"*, sin mencionar a los socios. El principio de "control ciego" también apunta en esa dirección: las alertas son desvíos/discrepancias que hoy solo ve el admin para decidir qué hacer.
- **Pregunta para Pablo/Ariel**: ¿Ariel/Eliana/Ema quieren ver el listado de alertas (desvíos de producción, discrepancias de caja, etc.) en su panel de solo lectura, o eso sigue siendo un tema exclusivo del administrador?
- **Si la respuesta es sí**: cambio de una línea en `src/modules/alertas/alertas.routes.ts` (agregar `'SOCIO'` al `requerirRoles`), sin tocar el modelo de datos.

### 2.2 ¿Los CAJEROS deberían ver el stock general?

- **Documento nuevo dice**: `GET /stock` → los 5 roles ✅, incluido CAJERO.
- **Código actual**: `GET /stock` → ADMINISTRADOR, SOCIO, ENCARGADO, PRODUCCION. **CAJERO no.**
- **Por qué está así**: en el diseño original del frontend del Módulo 1 (ya construido y verificado con Pablo/Ariel en su momento), solo ENCARGADO tiene la pestaña "Stock" en su pantalla — CAJERO nunca la tuvo. Hay un comentario viejo en el código que decía *"CAJERO no (lo tendrá el POS en módulo 2)"*, pero el Módulo 2 nunca terminó dándole esa pantalla — el cajero opera el POS sin ver niveles de stock crudos (si un producto llega a cero, el sistema bloquea la venta directamente, que es el mecanismo real que le importa al cajero).
- **Pregunta para Pablo/Ariel**: ¿el cajero necesita ver el stock general del local, o le alcanza con que el sistema bloquee la venta cuando algo se agota (que ya funciona)?
- **Si la respuesta es sí**: cambio de una línea en `src/modules/stock/stock.routes.ts`.

---

## 3. El documento está desactualizado — el sistema ya resolvió esto (no requiere acción)

Estos puntos figuran como "pendiente" en el documento nuevo, pero ya están implementados y verificados en el código actual:

| Punto | Estado real | Evidencia |
|---|---|---|
| Timer de `pedido:listo_no_retirado` sin job periódico | ✅ Implementado | `server.ts` corre un `setInterval` cada 2 min, umbral 30 min en `src/lib/constantes.ts` |
| Endpoint de trazabilidad completa por pedido no construido | ✅ Implementado | `GET /api/reportes/trazabilidad/pedido/:id`, reconstruye Proveedor → Ingreso → Lote → Transferencia → Venta |
| Historial de alertas sin link al evento que las disparó | ✅ Implementado | `frontend/src/features/admin/Alertas.tsx` — cada alerta linkea al lote/transferencia/turno |
| `.claude/` versionado en el repo | ✅ Resuelto | Está en `.gitignore`, cero archivos de esa carpeta trackeados en git |
| Cookie `sameSite: strict` sin resolver para producción | ✅ Resuelto | Pasa a `'none' + secure` en producción; `'lax'` en desarrollo (proxy de Vite) |

**No hay nada para hacer acá** — es solo para que sepan que el sistema está más adelante de lo que este documento en particular refleja.

---

## 4. Gap real que SÍ se corrigió hoy: tests de reportes y dashboard

El documento admitía este pendiente sin ambigüedad ("no se escribieron tests para los endpoints de reportes — la DB de test no estaba accesible en el entorno remoto"). Hoy:

- Se armaron **`tests/integration/reportes.test.ts`** (17 tests) y **`tests/integration/dashboard.test.ts`** (3 tests).
- Cubren: RBAC de los 9 endpoints (ADMIN/SOCIO acceden, CAJERO/ENCARGADO/PRODUCCION reciben 403), y el **contenido** de cada reporte contra datos armados a propósito:
  - Cadena de trazabilidad real de punta a punta: ingreso de mercadería → lote de producción (con desvío grande, para verificar que dispara la alerta) → transferencia a un local → venta — y se verifica que `GET /reportes/trazabilidad/pedido/:id` reconstruye cada tramo (proveedor, cantidades pesadas, operario, versión de ficha).
  - Un pedido anulado a propósito, para confirmar que **no** contamina ningún reporte de ventas (ventas por producto, por medio de pago, dashboard).
  - Gasto, retiro (con socio ARIEL), atención y merma, verificando que cada reporte separa correctamente qué mueve caja y qué no.
  - Cierre de turno cuadrando al centavo, verificado también desde `cierresDeCaja`.
  - Los 9 KPIs del dashboard (ventas, ticket promedio, ventas por medio, gastos, retiros, mermas, atenciones, lotes con desvío, alertas pendientes) contra los mismos datos, más el filtro por sucursal.
- **Resultado**: suite completa **222/222 tests pasan** (202 anteriores + 20 nuevos). `tsc --noEmit` sin errores.
- `CLAUDE-MODULO-2.md` actualizado con el detalle.

**Este ítem queda cerrado.** No requiere validación de nadie, es puramente técnico.

---

## 5. Otras diferencias menores (bajo impacto, no bloquean nada)

Detectadas al cruzar la tabla RBAC línea por línea. Ninguna expone datos financieros ni rompe el control ciego — son solo ajustes de quién puede leer catálogo/listados operativos:

| Endpoint | Documento dice | Código real | Impacto |
|---|---|---|---|
| `GET /proveedores` | ENCARGADO ❌ | ENCARGADO ✅ (puede leerlo) | Ninguno — es un listado de nombres de proveedores, no hay dato sensible |
| `GET /ingresos` | ENCARGADO ❌ | ENCARGADO ✅ (puede leerlo) | Ninguno — mismo caso |
| `GET /productos/precios-vigentes` | PRODUCCION ✅ | PRODUCCION ❌ (no lo necesita, no opera el POS) | Ninguno — Producción nunca vende, no le hace falta |
| `POST/PATCH/DELETE /stock-minimo` (config) | 3 verbos, path `/stock-minimo` | 1 solo endpoint POST (upsert cubre alta y edición), path real `/api/config-stock-minimo`, sin DELETE (desactivar es `activa:false` vía el mismo POST) | Ninguno funcional — el documento describe una API más granular que la que hace falta |

No recomiendo tocar nada de esto salvo que en la reunión con Pablo/Ariel surja que alguno de estos accesos realmente hace falta.

---

## 6. Nota sobre el schema del documento nuevo

El documento que pasaron todavía describe, en su borrador de schema, un modelo `Combo` separado (con `precioCombo` propio) y `comboId` en `ItemDePedido`/`Atencion`, y `Turno.id` como `String`/`cuid`. **Nada de eso existe en el código real** — se corrigió a propósito durante la Fase 1 del Módulo 2 (documentado en `CLAUDE-MODULO-2.md §0`): los combos son `Producto{tipo:COMBO}` + `ComboComponente`, sin campo `comboId` en ningún lado, y todos los IDs son enteros autoincrement como el resto del sistema. No es un bug ni algo para arreglar — es que la versión de este documento en particular quedó con un borrador de schema viejo. Si en algún momento se actualiza este documento maestro, valdría la pena reemplazar esa sección por la que ya está en `CLAUDE-MODULO-2.md §0` y `§3`.

---

## 7. Qué necesito que confirmen

1. **Alertas para SOCIO** (§2.1): ¿sí o no?
2. **Stock general para CAJERO** (§2.2): ¿sí o no?

Con esas dos respuestas, el sistema queda 100% alineado con este documento (más allá de los ajustes cosméticos de §5, que no creo que hagan falta salvo que digan lo contrario).
