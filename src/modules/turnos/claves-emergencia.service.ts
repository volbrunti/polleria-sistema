import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import * as alertasService from '../alertas/alertas.service';
import { calcularExpiracionClave, claveUsable, generarCodigoClave } from './turnos.calculos';

// Clave de emergencia (CLAUDE-MODULO-2.md §5.1, camino B): código aleatorio
// de un solo uso, expira a los 10 minutos. El admin lo genera desde su panel
// y lo dicta por teléfono; el cajero lo ingresa en la pantalla de bloqueo.

// Solo ADMIN. El código se devuelve UNA sola vez (nunca se vuelve a mostrar);
// generar una clave nueva para el mismo turno invalida las anteriores no usadas.
export async function generarClave(params: { usuarioAdminId: number; turnoId?: number }) {
  if (params.turnoId) {
    const turno = await prisma.turno.findUnique({ where: { id: params.turnoId } });
    if (!turno) throw Errores.noEncontrado('Turno');
    if (turno.estado !== 'BLOQUEADO') throw Errores.turnoNoBloqueado();
  }

  return prisma.$transaction(async (tx) => {
    // "Si la pierde, genera otra (la anterior queda invalidada)"
    await tx.claveDeEmergencia.updateMany({
      where: { turnoId: params.turnoId ?? null, usada: false },
      data: { expiraEn: new Date() },
    });

    const clave = await tx.claveDeEmergencia.create({
      data: {
        codigo: generarCodigoClave(),
        generadaPorId: params.usuarioAdminId,
        turnoId: params.turnoId ?? null,
        expiraEn: calcularExpiracionClave(),
      },
    });

    // El código NO va a la auditoría (es un secreto de un solo uso)
    await registrarAuditoria(tx, {
      accion: 'GENERAR_CLAVE_EMERGENCIA',
      entidad: 'ClaveDeEmergencia',
      entidadId: clave.id,
      usuarioId: params.usuarioAdminId,
      datosNuevos: { turnoId: params.turnoId ?? null, expiraEn: clave.expiraEn },
    });

    return { id: clave.id, codigo: clave.codigo, expiraEn: clave.expiraEn };
  }, OPCIONES_TX);
}

// La usa el cajero desde la pantalla de bloqueo. Cualquier fallo responde el
// mismo error genérico (no revela si el código existe, expiró o es ajeno).
export async function usarClave(params: { codigo: string; turnoId: number; usuarioId: number }) {
  const resultado = await prisma.$transaction(async (tx) => {
    const turno = await tx.turno.findUnique({
      where: { id: params.turnoId },
      include: { bloqueo: true },
    });
    if (!turno) throw Errores.noEncontrado('Turno');
    if (turno.estado !== 'BLOQUEADO' || !turno.bloqueo) throw Errores.turnoNoBloqueado();

    const clave = await tx.claveDeEmergencia.findUnique({ where: { codigo: params.codigo.toUpperCase() } });
    if (!clave || !claveUsable(clave, params.turnoId)) throw Errores.claveInvalida();

    await tx.claveDeEmergencia.update({
      where: { id: clave.id },
      data: { usada: true, usadaEn: new Date() },
    });

    const desbloqueado = await tx.turno.update({
      where: { id: turno.id },
      data: { estado: 'ABIERTO' },
      include: {
        sucursal: { select: { nombre: true } },
        usuarioCajero: { select: { username: true } },
        arqueos: true,
      },
    });

    await tx.bloqueoDeTurno.update({
      where: { id: turno.bloqueo.id },
      data: {
        estado: 'DESBLOQUEADO',
        tipoDesbloqueo: 'CLAVE_EMERGENCIA',
        // Autoriza quien GENERÓ la clave (el admin), no quien la tipeó
        usuarioAutorizanteId: clave.generadaPorId,
        fechaDesbloqueo: new Date(),
        claveEmergenciaId: clave.id,
      },
    });

    await registrarAuditoria(tx, {
      accion: 'DESBLOQUEO_TURNO_CLAVE',
      entidad: 'Turno',
      entidadId: turno.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        turnoId: turno.id,
        claveEmergenciaId: clave.id,
        generadaPorId: clave.generadaPorId,
        usuarioCajeroActualId: turno.usuarioCajeroId,
        usuarioCajeroAnteriorId: turno.bloqueo.usuarioCajeroAnteriorId,
      },
    });

    return desbloqueado;
  }, OPCIONES_TX);

  alertasService.emitirAAdmins('turno:desbloqueado', { turnoId: resultado.id });
  alertasService.emitirASucursal(resultado.sucursalId, 'turno:desbloqueado', { turnoId: resultado.id });
  return resultado;
}
