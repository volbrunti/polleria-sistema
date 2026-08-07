-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('ABIERTO', 'BLOQUEADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "MomentoArqueo" AS ENUM ('APERTURA', 'CIERRE');

-- CreateEnum
CREATE TYPE "TipoArqueo" AS ENUM ('EFECTIVO', 'POLLOS_MARCADOS');

-- CreateEnum
CREATE TYPE "ResultadoArqueo" AS ENUM ('COINCIDE', 'FALTANTE', 'SOBRANTE');

-- CreateEnum
CREATE TYPE "EstadoBloqueo" AS ENUM ('BLOQUEADO', 'DESBLOQUEADO');

-- CreateEnum
CREATE TYPE "TipoDesbloqueo" AS ENUM ('REMOTO', 'CLAVE_EMERGENCIA');

-- CreateEnum
CREATE TYPE "TipoPedido" AS ENUM ('PRESENCIAL', 'A_RETIRAR');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('EN_PREPARACION', 'LISTO', 'ENTREGADO', 'LISTO_NO_RETIRADO', 'REASIGNADO', 'PERDIDO', 'ANULADO');

-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('EFECTIVO', 'DEBITO', 'CREDITO', 'MERCADO_PAGO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "TipoCostoCero" AS ENUM ('DESPERDICIO_QUEMADO', 'RETORNO_A_PRODUCCION');

-- CreateEnum
CREATE TYPE "SocioRetiro" AS ENUM ('ARIEL', 'ELIANA', 'EMA');

-- CreateEnum
CREATE TYPE "TipoTicket" AS ENUM ('NUEVO', 'ACTUALIZACION', 'ANULACION');

-- CreateTable
CREATE TABLE "turnos" (
    "id" SERIAL NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "usuarioCajeroId" INTEGER NOT NULL,
    "fechaApertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" TIMESTAMP(3),
    "estado" "EstadoTurno" NOT NULL DEFAULT 'ABIERTO',

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arqueos" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "momento" "MomentoArqueo" NOT NULL,
    "tipo" "TipoArqueo" NOT NULL,
    "valorContado" DECIMAL(12,3) NOT NULL,
    "valorEsperado" DECIMAL(12,3) NOT NULL,
    "diferencia" DECIMAL(12,3) NOT NULL,
    "resultado" "ResultadoArqueo" NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arqueos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_turno" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "arqueoQueLoDisparoId" INTEGER NOT NULL,
    "usuarioCajeroAnteriorId" INTEGER,
    "estado" "EstadoBloqueo" NOT NULL DEFAULT 'BLOQUEADO',
    "tipoDesbloqueo" "TipoDesbloqueo",
    "usuarioAutorizanteId" INTEGER,
    "fechaDesbloqueo" TIMESTAMP(3),
    "claveEmergenciaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claves_emergencia" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "generadaPorId" INTEGER NOT NULL,
    "turnoId" INTEGER,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usada" BOOLEAN NOT NULL DEFAULT false,
    "usadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claves_emergencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "tipo" "TipoPedido" NOT NULL,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'EN_PREPARACION',
    "usuarioCajeroId" INTEGER NOT NULL,
    "pedidoOrigenId" INTEGER,
    "cuit" TEXT,
    "condicionIva" TEXT,
    "nroComprobante" TEXT,
    "canalOrigen" TEXT NOT NULL DEFAULT 'MOSTRADOR',
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" TIMESTAMP(3),

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_pedido" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "aclaraciones" TEXT,
    "esVentaCostoCero" BOOLEAN NOT NULL DEFAULT false,
    "tipoCostoCero" "TipoCostoCero",

    CONSTRAINT "items_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atenciones" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "motivoCodigo" TEXT NOT NULL,
    "motivoDetalle" TEXT,
    "usuarioId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atenciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos_caja" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "categoria" TEXT NOT NULL,
    "descripcion" TEXT,
    "usuarioId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gastos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retiros_caja" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "socio" "SocioRetiro" NOT NULL,
    "usuarioCajeroId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retiros_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_marcado_pollo" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_marcado_pollo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets_cocina" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "tipo" "TipoTicket" NOT NULL,
    "contenido" JSONB NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impreso" BOOLEAN NOT NULL DEFAULT false,
    "errorImpresion" TEXT,

    CONSTRAINT "tickets_cocina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_stock_minimo" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "minimo" DECIMAL(12,3) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "configuraciones_stock_minimo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turnos_sucursalId_estado_idx" ON "turnos"("sucursalId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "arqueos_turnoId_momento_tipo_key" ON "arqueos"("turnoId", "momento", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "bloqueos_turno_turnoId_key" ON "bloqueos_turno"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "claves_emergencia_codigo_key" ON "claves_emergencia"("codigo");

-- CreateIndex
CREATE INDEX "pedidos_sucursalId_estado_idx" ON "pedidos"("sucursalId", "estado");

-- CreateIndex
CREATE INDEX "pedidos_turnoId_idx" ON "pedidos"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_stock_minimo_productoId_sucursalId_key" ON "configuraciones_stock_minimo"("productoId", "sucursalId");

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_usuarioCajeroId_fkey" FOREIGN KEY ("usuarioCajeroId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_turno" ADD CONSTRAINT "bloqueos_turno_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_turno" ADD CONSTRAINT "bloqueos_turno_arqueoQueLoDisparoId_fkey" FOREIGN KEY ("arqueoQueLoDisparoId") REFERENCES "arqueos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_turno" ADD CONSTRAINT "bloqueos_turno_usuarioCajeroAnteriorId_fkey" FOREIGN KEY ("usuarioCajeroAnteriorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_turno" ADD CONSTRAINT "bloqueos_turno_usuarioAutorizanteId_fkey" FOREIGN KEY ("usuarioAutorizanteId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_turno" ADD CONSTRAINT "bloqueos_turno_claveEmergenciaId_fkey" FOREIGN KEY ("claveEmergenciaId") REFERENCES "claves_emergencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_emergencia" ADD CONSTRAINT "claves_emergencia_generadaPorId_fkey" FOREIGN KEY ("generadaPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claves_emergencia" ADD CONSTRAINT "claves_emergencia_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_usuarioCajeroId_fkey" FOREIGN KEY ("usuarioCajeroId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_pedidoOrigenId_fkey" FOREIGN KEY ("pedidoOrigenId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_pedido" ADD CONSTRAINT "items_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_pedido" ADD CONSTRAINT "items_pedido_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos_caja" ADD CONSTRAINT "gastos_caja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos_caja" ADD CONSTRAINT "gastos_caja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retiros_caja" ADD CONSTRAINT "retiros_caja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retiros_caja" ADD CONSTRAINT "retiros_caja_usuarioCajeroId_fkey" FOREIGN KEY ("usuarioCajeroId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_marcado_pollo" ADD CONSTRAINT "eventos_marcado_pollo_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_marcado_pollo" ADD CONSTRAINT "eventos_marcado_pollo_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_marcado_pollo" ADD CONSTRAINT "eventos_marcado_pollo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets_cocina" ADD CONSTRAINT "tickets_cocina_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_stock_minimo" ADD CONSTRAINT "configuraciones_stock_minimo_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_stock_minimo" ADD CONSTRAINT "configuraciones_stock_minimo_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
