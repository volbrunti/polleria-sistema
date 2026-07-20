-- Idempotencia del POST /pedidos: UUID por pedido armado en el POS.
-- Doble click / retry de red no duplican la venta (unique constraint).
ALTER TABLE "pedidos" ADD COLUMN "tokenIdempotencia" TEXT;

CREATE UNIQUE INDEX "pedidos_tokenIdempotencia_key" ON "pedidos"("tokenIdempotencia");
