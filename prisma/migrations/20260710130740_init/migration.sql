-- CreateEnum
CREATE TYPE "TipoSucursal" AS ENUM ('PRODUCCION', 'VENTA');

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "TipoProducto" AS ENUM ('MATERIA_PRIMA', 'ELABORADO', 'REVENTA');

-- CreateEnum
CREATE TYPE "UnidadDeMedida" AS ENUM ('KG', 'UNIDAD');

-- CreateEnum
CREATE TYPE "TipoMovimientoStock" AS ENUM ('INGRESO_COMPRA', 'CONSUMO_PRODUCCION', 'PRODUCCION_ALTA', 'DESPERDICIO_PRODUCCION', 'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA', 'VENTA', 'ANULACION_REPOSICION', 'ATENCION', 'MERMA_QUEMADO', 'RETORNO_A_PRODUCCION', 'MARCADO_POLLO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "TipoAlerta" AS ENUM ('DESVIO_PRODUCCION', 'DISCREPANCIA_TRANSFERENCIA', 'DISCREPANCIA_CAJA', 'BLOQUEO_TURNO', 'STOCK_MINIMO');

-- CreateEnum
CREATE TYPE "EstadoLoteProduccion" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "EstadoTransferencia" AS ENUM ('PENDIENTE_RECEPCION', 'CONFIRMADA', 'CONFIRMADA_CON_DISCREPANCIA');

-- CreateTable
CREATE TABLE "sucursales" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoSucursal" NOT NULL,
    "direccion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipo" "TipoProducto" NOT NULL,
    "unidadDeMedida" "UnidadDeMedida" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precios" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fechaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "precios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_stock" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "tipo" "TipoMovimientoStock" NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "tipoOrigen" TEXT NOT NULL,
    "origenId" INTEGER NOT NULL,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_auditoria" (
    "id" SERIAL NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datosAnteriores" JSONB,
    "datosNuevos" JSONB,

    CONSTRAINT "registros_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoAlerta" NOT NULL,
    "tipoOrigen" TEXT NOT NULL,
    "origenId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vista" BOOLEAN NOT NULL DEFAULT false,
    "detalle" JSONB NOT NULL,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "contacto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "esOtro" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresos_mercaderia" (
    "id" SERIAL NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "comentarioProveedorOtro" TEXT,
    "sucursalId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "fotoRemitoUrl" TEXT,

    CONSTRAINT "ingresos_mercaderia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_ingreso" (
    "id" SERIAL NOT NULL,
    "ingresoMercaderiaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidadSegunRemito" DECIMAL(12,3) NOT NULL,
    "cantidadRealPesada" DECIMAL(12,3) NOT NULL,
    "cantidadRestanteDisponible" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "lineas_ingreso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fichas_tecnicas" (
    "id" SERIAL NOT NULL,
    "productoElaboradoId" INTEGER NOT NULL,

    CONSTRAINT "fichas_tecnicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fichas_tecnicas_versiones" (
    "id" SERIAL NOT NULL,
    "fichaTecnicaId" INTEGER NOT NULL,
    "numeroVersion" INTEGER NOT NULL,
    "fechaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "rendimientoEsperado" DECIMAL(12,3) NOT NULL,
    "desperdicioEsperadoPct" DECIMAL(5,2) NOT NULL,
    "umbralDesvioAlertaPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "fichas_tecnicas_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredientes_receta" (
    "id" SERIAL NOT NULL,
    "fichaTecnicaVersionId" INTEGER NOT NULL,
    "productoInsumoId" INTEGER NOT NULL,
    "cantidadPorUnidadProducida" DECIMAL(12,4) NOT NULL,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ingredientes_receta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes_produccion" (
    "id" SERIAL NOT NULL,
    "productoElaboradoId" INTEGER NOT NULL,
    "fichaTecnicaVersionId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioOperarioId" INTEGER NOT NULL,
    "estado" "EstadoLoteProduccion" NOT NULL DEFAULT 'ABIERTO',
    "unidadesProducidasReales" DECIMAL(12,3),
    "desperdicioRealKg" DECIMAL(12,3),
    "unidadesEsperadas" DECIMAL(12,3),
    "desvioPct" DECIMAL(7,2),
    "alertaDisparada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lotes_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumos_usados" (
    "id" SERIAL NOT NULL,
    "loteDeProduccionId" INTEGER NOT NULL,
    "productoInsumoId" INTEGER NOT NULL,
    "lineaIngresoOrigenId" INTEGER NOT NULL,
    "cantidadUsada" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "insumos_usados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencias" (
    "id" SERIAL NOT NULL,
    "sucursalOrigenId" INTEGER NOT NULL,
    "sucursalDestinoId" INTEGER NOT NULL,
    "fechaHoraEnvio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioEmisorId" INTEGER NOT NULL,
    "usuarioReceptorId" INTEGER,
    "fechaHoraRecepcion" TIMESTAMP(3),
    "estado" "EstadoTransferencia" NOT NULL DEFAULT 'PENDIENTE_RECEPCION',

    CONSTRAINT "transferencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_transferencia" (
    "id" SERIAL NOT NULL,
    "transferenciaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidadEnviada" DECIMAL(12,3) NOT NULL,
    "cantidadRecibida" DECIMAL(12,3),
    "diferencia" DECIMAL(12,3),

    CONSTRAINT "lineas_transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_nombre_key" ON "sucursales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "productos_nombre_key" ON "productos"("nombre");

-- CreateIndex
CREATE INDEX "precios_productoId_fechaDesde_idx" ON "precios"("productoId", "fechaDesde");

-- CreateIndex
CREATE INDEX "movimientos_stock_productoId_sucursalId_idx" ON "movimientos_stock"("productoId", "sucursalId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tipoOrigen_origenId_idx" ON "movimientos_stock"("tipoOrigen", "origenId");

-- CreateIndex
CREATE INDEX "registros_auditoria_entidad_entidadId_idx" ON "registros_auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "registros_auditoria_usuarioId_idx" ON "registros_auditoria"("usuarioId");

-- CreateIndex
CREATE INDEX "registros_auditoria_fechaHora_idx" ON "registros_auditoria"("fechaHora");

-- CreateIndex
CREATE INDEX "alertas_vista_idx" ON "alertas"("vista");

-- CreateIndex
CREATE INDEX "alertas_tipo_idx" ON "alertas"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_nombre_key" ON "proveedores"("nombre");

-- CreateIndex
CREATE INDEX "lineas_ingreso_productoId_idx" ON "lineas_ingreso"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "fichas_tecnicas_productoElaboradoId_key" ON "fichas_tecnicas"("productoElaboradoId");

-- CreateIndex
CREATE UNIQUE INDEX "fichas_tecnicas_versiones_fichaTecnicaId_numeroVersion_key" ON "fichas_tecnicas_versiones"("fichaTecnicaId", "numeroVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ingredientes_receta_fichaTecnicaVersionId_productoInsumoId_key" ON "ingredientes_receta"("fichaTecnicaVersionId", "productoInsumoId");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_transferencia_transferenciaId_productoId_key" ON "lineas_transferencia"("transferenciaId", "productoId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios" ADD CONSTRAINT "precios_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios" ADD CONSTRAINT "precios_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "registros_auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_ingreso" ADD CONSTRAINT "lineas_ingreso_ingresoMercaderiaId_fkey" FOREIGN KEY ("ingresoMercaderiaId") REFERENCES "ingresos_mercaderia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_ingreso" ADD CONSTRAINT "lineas_ingreso_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fichas_tecnicas" ADD CONSTRAINT "fichas_tecnicas_productoElaboradoId_fkey" FOREIGN KEY ("productoElaboradoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fichas_tecnicas_versiones" ADD CONSTRAINT "fichas_tecnicas_versiones_fichaTecnicaId_fkey" FOREIGN KEY ("fichaTecnicaId") REFERENCES "fichas_tecnicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredientes_receta" ADD CONSTRAINT "ingredientes_receta_fichaTecnicaVersionId_fkey" FOREIGN KEY ("fichaTecnicaVersionId") REFERENCES "fichas_tecnicas_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredientes_receta" ADD CONSTRAINT "ingredientes_receta_productoInsumoId_fkey" FOREIGN KEY ("productoInsumoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_produccion" ADD CONSTRAINT "lotes_produccion_productoElaboradoId_fkey" FOREIGN KEY ("productoElaboradoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_produccion" ADD CONSTRAINT "lotes_produccion_fichaTecnicaVersionId_fkey" FOREIGN KEY ("fichaTecnicaVersionId") REFERENCES "fichas_tecnicas_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_produccion" ADD CONSTRAINT "lotes_produccion_usuarioOperarioId_fkey" FOREIGN KEY ("usuarioOperarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_usados" ADD CONSTRAINT "insumos_usados_loteDeProduccionId_fkey" FOREIGN KEY ("loteDeProduccionId") REFERENCES "lotes_produccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_usados" ADD CONSTRAINT "insumos_usados_productoInsumoId_fkey" FOREIGN KEY ("productoInsumoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_usados" ADD CONSTRAINT "insumos_usados_lineaIngresoOrigenId_fkey" FOREIGN KEY ("lineaIngresoOrigenId") REFERENCES "lineas_ingreso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_sucursalOrigenId_fkey" FOREIGN KEY ("sucursalOrigenId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_sucursalDestinoId_fkey" FOREIGN KEY ("sucursalDestinoId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_usuarioEmisorId_fkey" FOREIGN KEY ("usuarioEmisorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_usuarioReceptorId_fkey" FOREIGN KEY ("usuarioReceptorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_transferencia" ADD CONSTRAINT "lineas_transferencia_transferenciaId_fkey" FOREIGN KEY ("transferenciaId") REFERENCES "transferencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_transferencia" ADD CONSTRAINT "lineas_transferencia_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
