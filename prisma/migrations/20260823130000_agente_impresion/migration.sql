-- Agente de impresión (CLAUDE.md §5 Flujo 4, §11.1): Railway no tiene ruta a
-- las IPs privadas de la LAN del local, así que un proceso en una PC del
-- local recibe el buffer ESC/POS por Socket.io y hace el TCP directo. El
-- token queda hasheado, igual criterio que refresh_tokens.tokenHash.

-- CreateTable
CREATE TABLE "agentes_impresion" (
    "id" SERIAL NOT NULL,
    "sucursalId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ultimaConexion" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agentes_impresion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agentes_impresion_sucursalId_key" ON "agentes_impresion"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "agentes_impresion_tokenHash_key" ON "agentes_impresion"("tokenHash");

-- AddForeignKey
ALTER TABLE "agentes_impresion" ADD CONSTRAINT "agentes_impresion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
