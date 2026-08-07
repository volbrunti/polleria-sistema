/*
  Warnings:

  - Added the required column `montoTotal` to the `items_pedido` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "items_pedido" ADD COLUMN     "montoTotal" DECIMAL(12,2) NOT NULL;
