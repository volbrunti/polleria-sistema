import type { Rol } from '@prisma/client';

// CONTROL CIEGO (Flujo 3): cantidadEnviada y diferencia son visibles SOLO para
// ADMINISTRADOR, SOCIO y el usuario emisor. El receptor jamás las ve —
// ni antes ni después de confirmar. Whitelist explícita.

interface LineaConProducto {
  id: number;
  productoId: number;
  producto?: { nombre: string; unidadDeMedida: string } | null;
  cantidadEnviada: unknown;
  cantidadRecibida: unknown;
  diferencia: unknown;
}

interface TransferenciaConRelaciones {
  id: number;
  sucursalOrigenId: number;
  sucursalOrigen?: { nombre: string } | null;
  sucursalDestinoId: number;
  sucursalDestino?: { nombre: string } | null;
  fechaHoraEnvio: Date;
  usuarioEmisorId: number;
  usuarioEmisor?: { username: string } | null;
  usuarioReceptorId: number | null;
  usuarioReceptor?: { username: string } | null;
  fechaHoraRecepcion: Date | null;
  estado: string;
  lineas: LineaConProducto[];
}

export function puedeVerCantidadEnviada(
  transferencia: { usuarioEmisorId: number },
  rol: Rol,
  usuarioId: number,
): boolean {
  return rol === 'ADMINISTRADOR' || rol === 'SOCIO' || transferencia.usuarioEmisorId === usuarioId;
}

export function serializarTransferencia(
  t: TransferenciaConRelaciones,
  rol: Rol,
  usuarioId: number,
) {
  const verEnviada = puedeVerCantidadEnviada(t, rol, usuarioId);
  return {
    id: t.id,
    sucursalOrigenId: t.sucursalOrigenId,
    sucursalOrigen: t.sucursalOrigen?.nombre,
    sucursalDestinoId: t.sucursalDestinoId,
    sucursalDestino: t.sucursalDestino?.nombre,
    fechaHoraEnvio: t.fechaHoraEnvio,
    usuarioEmisor: t.usuarioEmisor?.username,
    usuarioReceptor: t.usuarioReceptor?.username ?? null,
    fechaHoraRecepcion: t.fechaHoraRecepcion,
    estado: t.estado,
    lineas: t.lineas.map((l) => ({
      id: l.id,
      productoId: l.productoId,
      producto: l.producto?.nombre,
      unidadDeMedida: l.producto?.unidadDeMedida,
      cantidadRecibida: l.cantidadRecibida?.toString() ?? null,
      ...(verEnviada
        ? {
            cantidadEnviada: l.cantidadEnviada?.toString() ?? null,
            diferencia: l.diferencia?.toString() ?? null,
          }
        : {}),
    })),
  };
}
