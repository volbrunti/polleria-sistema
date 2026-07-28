-- CreateTable
CREATE TABLE "_ProveedorProductosHabituales" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ProveedorProductosHabituales_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ProveedorProductosHabituales_B_index" ON "_ProveedorProductosHabituales"("B");

-- AddForeignKey
ALTER TABLE "_ProveedorProductosHabituales" ADD CONSTRAINT "_ProveedorProductosHabituales_A_fkey" FOREIGN KEY ("A") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProveedorProductosHabituales" ADD CONSTRAINT "_ProveedorProductosHabituales_B_fkey" FOREIGN KEY ("B") REFERENCES "proveedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
