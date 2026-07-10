-- Constraint de negocio (CLAUDE.md §9): una sola versión ACTIVA por ficha técnica.
-- La capa de servicio ya lo garantiza; este índice parcial lo blinda a nivel de DB
-- contra escrituras directas que salteen la API (scripts, migraciones manuales, bugs).
CREATE UNIQUE INDEX "uq_una_version_activa_por_ficha"
ON "fichas_tecnicas_versiones" ("fichaTecnicaId")
WHERE "activa" = true;
