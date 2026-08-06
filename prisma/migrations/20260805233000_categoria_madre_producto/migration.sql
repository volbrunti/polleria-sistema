-- Agrupador de primer nivel del POS. Nullable: los productos sin madre caen
-- en "Otros" y el admin los reagrupa desde Catálogo. Solo aplica a lo que se
-- vende — la materia prima no aparece en el POS.
ALTER TABLE "productos" ADD COLUMN "categoriaMadre" TEXT;

-- Backfill del catálogo actual (reunión 4/8). Provisorio: el cliente todavía
-- no pasó su agrupación definitiva, y cada producto es editable de a uno.
UPDATE "productos" SET "categoriaMadre" = CASE
  WHEN "categoria" IN ('Pollos', 'Combos Pollo')                                   THEN 'Pollos'
  WHEN "categoria" IN ('Hamburguesas', 'Lomitos', 'Milanesas')                     THEN 'Sándwiches'
  WHEN "categoria" = 'Empanadas'                                                   THEN 'Empanadas'
  WHEN "categoria" IN ('Sorrentinos', 'Tartas', 'Porciones de carne', 'Escabeches') THEN 'Platos'
  WHEN "categoria" IN ('Papas', 'Ensaladas', 'Panificados', 'Adicionales')          THEN 'Guarniciones'
  WHEN "categoria" = 'Bebidas'                                                     THEN 'Bebidas'
  ELSE 'Otros'
END
WHERE "tipo" <> 'MATERIA_PRIMA';
