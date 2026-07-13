-- AlterTable
ALTER TABLE "precios" ADD COLUMN     "cantidad" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "precios_productoId_cantidad_fechaDesde_idx" ON "precios"("productoId", "cantidad", "fechaDesde");
