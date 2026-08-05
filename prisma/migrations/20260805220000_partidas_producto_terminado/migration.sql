-- Saldo del producto terminado que todavía no se envió. Mismo patrón que
-- lineas_ingreso.cantidadRestanteDisponible para la materia prima: convierte
-- al lote en la "partida" del producto terminado.
ALTER TABLE "lotes_produccion" ADD COLUMN "cantidadRestanteDisponible" DECIMAL(12,3);

-- Backfill: los lotes ya cerrados quedan en 0. Su stock existe pero sin
-- trazabilidad de lote (es anterior a este cambio), así que se envía por el
-- camino "sin lote" hasta que se agote.
UPDATE "lotes_produccion" SET "cantidadRestanteDisponible" = 0 WHERE "estado" = 'CERRADO';

-- De qué lote salió cada línea de transferencia. Nullable: hay stock que no
-- viene de un lote (reventa, ajustes, retornos, y todo lo previo a este cambio).
ALTER TABLE "lineas_transferencia" ADD COLUMN "loteOrigenId" INTEGER;

ALTER TABLE "lineas_transferencia"
  ADD CONSTRAINT "lineas_transferencia_loteOrigenId_fkey"
  FOREIGN KEY ("loteOrigenId") REFERENCES "lotes_produccion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- El unique pasa a incluir el lote: un envío puede llevar el mismo producto
-- desde dos partidas distintas.
DROP INDEX IF EXISTS "lineas_transferencia_transferenciaId_productoId_key";
CREATE UNIQUE INDEX "lineas_transferencia_transferenciaId_productoId_loteOrigenId_key"
  ON "lineas_transferencia"("transferenciaId", "productoId", "loteOrigenId");
