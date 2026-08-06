-- Recargo de tarjeta (reunión 4/8). `monto` del pago sigue siendo la parte
-- que cubre el pedido; el recargo se guarda aparte para que el total del
-- pedido siga cerrando y el desglose quede visible en los reportes.
ALTER TABLE "pagos" ADD COLUMN "recargoPct" DECIMAL(5,2);
ALTER TABLE "pagos" ADD COLUMN "montoRecargo" DECIMAL(12,2);

-- Lista de porcentajes que el admin deja cargados para que el cajero elija.
CREATE TABLE "recargos_tarjeta" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recargos_tarjeta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recargos_tarjeta_medio_nombre_key" ON "recargos_tarjeta"("medio", "nombre");
