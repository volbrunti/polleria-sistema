-- Comanderas por destino (CLAUDE.md §5 Flujo 4, §6 y §9).
-- Cada local de venta tiene DOS impresoras (cocina y mostrador), así que el
-- resultado de impresión pasa de ser un par de columnas en tickets_cocina a
-- una fila por intento en impresiones_comandera.
--
-- PÉRDIDA DE DATOS ACEPTADA: el DROP COLUMN de tickets_cocina.impreso y
-- .errorImpresion descarta el resultado de impresión de los tickets ya
-- existentes. Es un dato operativo efímero (si una comanda vieja se imprimió
-- o no), no financiero ni de auditoría — los tickets en sí, con su contenido,
-- quedan intactos. Los tickets previos a esta migración simplemente no van a
-- tener filas en impresiones_comandera.

-- CreateEnum
CREATE TYPE "DestinoComandera" AS ENUM ('COCINA', 'MOSTRADOR');

-- AlterTable
ALTER TABLE "tickets_cocina" DROP COLUMN "errorImpresion",
DROP COLUMN "impreso";

-- CreateTable
CREATE TABLE "configuraciones_comandera" (
    "id" SERIAL NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "destino" "DestinoComandera" NOT NULL,
    "nombre" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "puerto" INTEGER NOT NULL DEFAULT 9100,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "configuraciones_comandera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impresiones_comandera" (
    "id" SERIAL NOT NULL,
    "ticketCocinaId" INTEGER NOT NULL,
    "configuracionComanderaId" INTEGER NOT NULL,
    "impreso" BOOLEAN NOT NULL DEFAULT false,
    "errorImpresion" TEXT,
    "fechaHoraIntento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impresiones_comandera_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_comandera_sucursalId_destino_key" ON "configuraciones_comandera"("sucursalId", "destino");

-- CreateIndex
CREATE INDEX "impresiones_comandera_ticketCocinaId_idx" ON "impresiones_comandera"("ticketCocinaId");

-- CreateIndex
CREATE INDEX "tickets_cocina_pedidoId_idx" ON "tickets_cocina"("pedidoId");

-- AddForeignKey
ALTER TABLE "configuraciones_comandera" ADD CONSTRAINT "configuraciones_comandera_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impresiones_comandera" ADD CONSTRAINT "impresiones_comandera_ticketCocinaId_fkey" FOREIGN KEY ("ticketCocinaId") REFERENCES "tickets_cocina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impresiones_comandera" ADD CONSTRAINT "impresiones_comandera_configuracionComanderaId_fkey" FOREIGN KEY ("configuracionComanderaId") REFERENCES "configuraciones_comandera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

