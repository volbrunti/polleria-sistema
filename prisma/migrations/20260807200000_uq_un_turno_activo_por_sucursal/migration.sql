-- Constraint de negocio (CLAUDE.md §5 Flujo 5): un solo turno ACTIVO por sucursal.
-- Mismo criterio que uq_una_version_activa_por_ficha: la capa de servicio ya
-- chequea (turnos.service.ts::abrirTurno), pero ese chequeo es un findFirst
-- seguido de un create, y bajo READ COMMITTED dos aperturas en paralelo pasan
-- las dos. Auditoría 2026-08-07 (C-3) lo reprodujo: 201/201, dos turnos activos.
--
-- Con dos turnos abiertos, exigirTurnoAbierto agarra cualquiera de los dos y las
-- ventas se reparten entre ambos, con lo que el efectivo esperado del cierre
-- (que filtra por turnoId) queda partido al medio y el arqueo no cuadra nunca.
CREATE UNIQUE INDEX "uq_un_turno_activo_por_sucursal"
ON "turnos" ("sucursalId")
WHERE "estado" IN ('ABIERTO', 'BLOQUEADO');
