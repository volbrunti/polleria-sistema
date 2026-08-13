-- Auditoría 2026-08-07 — dos hallazgos que se resuelven en la misma migración.
--
-- C-4 · tokenIdempotencia en las operaciones de caja.
-- Gastos, retiros, marcado de pollos y atenciones son INSERT puros: sin token,
-- un reintento después de un timeout de red duplica el registro, y dos gastos
-- idénticos no se distinguen de dos gastos legítimos iguales. Mismo mecanismo
-- que Pedido.tokenIdempotencia, que ya estaba resuelto.
--
-- C-7 · Índices en las FK del camino caliente.
-- En PostgreSQL una FK no crea índice sola (a diferencia de MySQL) y Prisma
-- solo emite los @@index declarados. Estas cuatro estaban haciendo seq scan:
--   · items_pedido.pedidoId → en TODA operación de pedido (include: items)
--   · pagos.pedidoId        → en cada cierre de turno (suma de efectivo)
--   · movimientos_stock.sucursalId → pantalla Stock del admin, sobre la tabla
--     que más rápido crece del sistema
--   · turnoId de gastos/retiros/marcado → en cada cierre de turno
-- Hoy las tablas son chicas y el planificador elige seq scan correctamente;
-- esto es para que sigan siendo baratas a 14.500 pedidos por año.

-- AlterTable
ALTER TABLE "atenciones" ADD COLUMN     "tokenIdempotencia" TEXT;

-- AlterTable
ALTER TABLE "eventos_marcado_pollo" ADD COLUMN     "tokenIdempotencia" TEXT;

-- AlterTable
ALTER TABLE "gastos_caja" ADD COLUMN     "tokenIdempotencia" TEXT;

-- AlterTable
ALTER TABLE "retiros_caja" ADD COLUMN     "tokenIdempotencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "atenciones_tokenIdempotencia_key" ON "atenciones"("tokenIdempotencia");

-- CreateIndex
CREATE INDEX "atenciones_turnoId_idx" ON "atenciones"("turnoId");

-- CreateIndex
CREATE INDEX "atenciones_productoId_idx" ON "atenciones"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_marcado_pollo_tokenIdempotencia_key" ON "eventos_marcado_pollo"("tokenIdempotencia");

-- CreateIndex
CREATE INDEX "eventos_marcado_pollo_turnoId_idx" ON "eventos_marcado_pollo"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "gastos_caja_tokenIdempotencia_key" ON "gastos_caja"("tokenIdempotencia");

-- CreateIndex
CREATE INDEX "gastos_caja_turnoId_idx" ON "gastos_caja"("turnoId");

-- CreateIndex
CREATE INDEX "items_pedido_pedidoId_idx" ON "items_pedido"("pedidoId");

-- CreateIndex
CREATE INDEX "items_pedido_productoId_idx" ON "items_pedido"("productoId");

-- CreateIndex
CREATE INDEX "movimientos_stock_sucursalId_idx" ON "movimientos_stock"("sucursalId");

-- CreateIndex
CREATE INDEX "pagos_pedidoId_idx" ON "pagos"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "retiros_caja_tokenIdempotencia_key" ON "retiros_caja"("tokenIdempotencia");

-- CreateIndex
CREATE INDEX "retiros_caja_turnoId_idx" ON "retiros_caja"("turnoId");

-- RenameIndex
-- Deriva vieja: el nombre se había truncado a 63 caracteres (límite de
-- PostgreSQL) y no coincidía con el que espera Prisma. Se alinea acá.
ALTER INDEX "lineas_transferencia_transferenciaId_productoId_loteOrigenId_ke" RENAME TO "lineas_transferencia_transferenciaId_productoId_loteOrigenI_key";
