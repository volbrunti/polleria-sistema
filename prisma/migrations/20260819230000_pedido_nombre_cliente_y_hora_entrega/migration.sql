-- Pedido de Pablo tras la prueba en vivo (reunión post-prueba 2026-08):
-- nombre del cliente para identificar el pedido en la comandera y en
-- Pedidos Activos, y una hora puntual de entrega prometida ("va a estar
-- para las 9:15") para PRESENCIAL y A_RETIRAR. Ambos opcionales.
--
-- horaEntregaSolicitada es TEXT ("HH:MM"), no DateTime: siempre es el mismo
-- día del pedido, y evita combinar fecha+hora con zona horaria para un dato
-- que solo se muestra como texto en pantalla y en el ticket.

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "nombreCliente" TEXT,
ADD COLUMN     "horaEntregaSolicitada" TEXT;
