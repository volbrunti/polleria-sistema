-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "avisoNoRetiradoEmitido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fechaListoNoRetirado" TIMESTAMP(3);
