-- AlterEnum
ALTER TYPE "TipoProducto" ADD VALUE 'COMBO';

-- CreateTable
CREATE TABLE "combo_componentes" (
    "id" SERIAL NOT NULL,
    "comboId" INTEGER NOT NULL,
    "productoComponenteId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "combo_componentes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "combo_componentes_comboId_productoComponenteId_key" ON "combo_componentes"("comboId", "productoComponenteId");

-- AddForeignKey
ALTER TABLE "combo_componentes" ADD CONSTRAINT "combo_componentes_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_componentes" ADD CONSTRAINT "combo_componentes_productoComponenteId_fkey" FOREIGN KEY ("productoComponenteId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
