-- Retiro de socio / venta a empleado (reunión 4/8).
ALTER TYPE "TipoCostoCero" ADD VALUE 'RETIRO_SOCIO';

CREATE TYPE "BeneficiarioPedido" AS ENUM ('SOCIO', 'EMPLEADO');

ALTER TABLE "pedidos" ADD COLUMN "beneficiario" "BeneficiarioPedido";
ALTER TABLE "pedidos" ADD COLUMN "socioBeneficiario" "SocioRetiro";
-- Congelado al confirmar: cambiar el % después no toca los pedidos viejos.
ALTER TABLE "pedidos" ADD COLUMN "descuentoPct" DECIMAL(5,2);

-- Parámetros que el admin cambia sin tocar código.
CREATE TABLE "configuracion_general" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_general_pkey" PRIMARY KEY ("clave")
);

INSERT INTO "configuracion_general" ("clave", "valor", "descripcion", "actualizado")
VALUES (
    'DESCUENTO_EMPLEADO_PCT',
    '20',
    'Descuento que se aplica a un pedido marcado como venta a empleado. El total de cada línea se redondea hacia abajo.',
    CURRENT_TIMESTAMP
);
