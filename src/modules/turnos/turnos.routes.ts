import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as turnosService from './turnos.service';
import * as clavesService from './claves-emergencia.service';
import { serializarTurno } from './turnos.serializers';

const arqueoSchema = z.object({
  // ADMIN debe indicar sucursal; CAJERO/ENCARGADO usan la propia (se ignora
  // cualquier intento de operar sobre otra — 403 en el servicio)
  sucursalId: z.number().int().positive().optional(),
  conteoEfectivo: z.number().nonnegative(),
  conteoPollosMarcados: z.number().nonnegative(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function turnosRoutes(app: FastifyInstance) {
  const operativos = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'ENCARGADO', 'CAJERO')] as const;
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;
  const adminYSocio = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] as const;

  // Apertura con arqueo doble ciego. Si hay discrepancia el turno nace
  // BLOQUEADO y la respuesta al cajero es un mensaje genérico sin números.
  app.post('/abrir', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = arqueoSchema.parse(req.body);
    const turno = await turnosService.abrirTurno({ usuarioId: req.usuario.id, ...datos });
    if (turno.estado === 'BLOQUEADO') {
      return reply.code(201).send({
        turno: serializarTurno(turno, req.usuario.rol),
        bloqueado: true,
        mensaje:
          'Hay una diferencia en el conteo. Se notificó al administrador. Esperá la autorización para continuar.',
      });
    }
    return reply.code(201).send({ turno: serializarTurno(turno, req.usuario.rol), bloqueado: false });
  });

  // Cierre con arqueo doble ciego. Nunca bloquea; el cajero recibe SOLO el
  // resumen por unidades (sin plata) — la discrepancia va al admin por alerta.
  app.post('/cerrar', { preHandler: [...operativos] }, async (req) => {
    const datos = arqueoSchema.parse(req.body);
    const resultado = await turnosService.cerrarTurno({ usuarioId: req.usuario.id, ...datos });
    return {
      turno: serializarTurno(resultado.turno, req.usuario.rol),
      ventasPorUnidad: resultado.ventasPorUnidad,
      // El conteo que declaró el propio cajero — para que sepa qué le queda
      pollosMarcadosContados: datos.conteoPollosMarcados,
    };
  });

  // Turno activo (abierto o bloqueado) de la sucursal del usuario.
  app.get('/activo', { preHandler: [...operativos] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const sucursalId = await turnosService.resolverSucursalOperativa(req.usuario.id, query.sucursalId);
    const turno = await turnosService.turnoActivoDeSucursal(sucursalId);
    return { turno: turno ? serializarTurno(turno, req.usuario.rol) : null };
  });

  // Desbloqueo remoto desde el panel del admin.
  app.post('/:id/desbloquear', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const turno = await turnosService.desbloquearRemoto({ turnoId: id, usuarioAdminId: req.usuario.id });
    return serializarTurno(turno, req.usuario.rol);
  });

  // Historial (solo admin/socio — información financiera).
  app.get('/', { preHandler: [...adminYSocio] }, async (req) => {
    const query = z
      .object({
        sucursalId: z.coerce.number().int().positive().optional(),
        estado: z.enum(['ABIERTO', 'BLOQUEADO', 'CERRADO']).optional(),
      })
      .parse(req.query);
    const turnos = await turnosService.listarTurnos(query);
    return turnos.map((t) => serializarTurno(t, req.usuario.rol));
  });

  // Resumen financiero completo de un turno (solo admin/socio). El serializer
  // es una whitelist (control ciego) que no conoce las colecciones del
  // resumen — se adjuntan explícitamente: este endpoint ya está gateado a
  // roles que ven todo lo financiero.
  app.get('/:id/resumen', { preHandler: [...adminYSocio] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const resumen = await turnosService.resumenDeTurno(id);
    return {
      ...resumen,
      turno: {
        ...serializarTurno(resumen.turno, req.usuario.rol),
        bloqueo: resumen.turno.bloqueo,
        gastos: resumen.turno.gastos,
        retiros: resumen.turno.retiros,
        atenciones: resumen.turno.atenciones,
        eventosMarcado: resumen.turno.eventosMarcado,
      },
    };
  });
}

export async function clavesEmergenciaRoutes(app: FastifyInstance) {
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;
  const operativos = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'ENCARGADO', 'CAJERO')] as const;

  // Genera la clave — se muestra UNA sola vez, invalida las anteriores.
  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const datos = z.object({ turnoId: z.number().int().positive().optional() }).parse(req.body ?? {});
    const clave = await clavesService.generarClave({ usuarioAdminId: req.usuario.id, turnoId: datos.turnoId });
    return reply.code(201).send(clave);
  });

  // La ingresa el cajero desde la pantalla de bloqueo.
  app.post('/usar', { preHandler: [...operativos] }, async (req) => {
    const datos = z
      .object({ codigo: z.string().min(4), turnoId: z.number().int().positive() })
      .parse(req.body);
    const turno = await clavesService.usarClave({ ...datos, usuarioId: req.usuario.id });
    return { turno: serializarTurno(turno, req.usuario.rol), desbloqueado: true };
  });
}
