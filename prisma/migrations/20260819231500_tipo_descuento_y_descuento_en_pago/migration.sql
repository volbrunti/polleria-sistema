-- Pedido post-prueba en vivo: mover el descuento de empleado/encargado al
-- momento de cobrar, con una tabla de tipos configurable en vez de un único
-- % global — mismo patrón que RecargoTarjeta, mirado al revés.

-- CreateEnum
CREATE TYPE "TipoBeneficiarioDescuento" AS ENUM ('EMPLEADO', 'ENCARGADO');

-- CreateTable
CREATE TABLE "tipos_descuento" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoBeneficiarioDescuento" NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_descuento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_descuento_tipo_nombre_key" ON "tipos_descuento"("tipo", "nombre");

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "descuentoPct" DECIMAL(5,2),
ADD COLUMN     "montoDescuento" DECIMAL(12,2);
