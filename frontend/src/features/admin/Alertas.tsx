import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarAlertas, marcarVista } from '../../api/alertas';
import { listarProductos } from '../../api/productos';
import { listarUsuarios } from '../../api/usuarios';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';
import type { Alerta } from '../../api/types';

const ESTILO_TIPO: Record<string, { texto: string; color: string; bg: string }> = {
  DESVIO_PRODUCCION: { texto: 'DESVÍO DE PRODUCCIÓN', color: '#a02514', bg: '#faeae7' },
  DISCREPANCIA_TRANSFERENCIA: { texto: 'DISCREPANCIA EN TRANSFERENCIA', color: '#7a5d00', bg: '#fff7d9' },
  DISCREPANCIA_CAJA: { texto: 'DISCREPANCIA DE CAJA', color: '#7a5d00', bg: '#fff7d9' },
  BLOQUEO_TURNO: { texto: 'BLOQUEO DE TURNO', color: '#a02514', bg: '#faeae7' },
  STOCK_MINIMO: { texto: 'STOCK MÍNIMO', color: '#7a5d00', bg: '#fff7d9' },
};

interface CampoDetalle {
  k: string;
  v: string;
  destacado?: boolean;
}

function camposDeAlerta(
  alerta: Alerta,
  nombreProducto: (id: number) => string,
  nombreUsuario: (id: number) => string,
): CampoDetalle[] {
  const d = alerta.detalle as Record<string, unknown>;
  if (alerta.tipo === 'DESVIO_PRODUCCION') {
    return [
      { k: 'Producto', v: nombreProducto(d.productoElaboradoId as number) },
      { k: 'Lote', v: `L-${d.loteId}` },
      { k: 'Operario', v: nombreUsuario(d.operarioId as number) },
      { k: 'Unidades esperadas', v: fmtNumero(d.unidadesEsperadas as string) },
      { k: 'Unidades reales', v: fmtNumero(d.unidadesReales as string) },
      { k: 'Desvío', v: `${fmtNumero(d.desvioPct as string)} %`, destacado: true },
      { k: 'Desperdicio', v: `${fmtNumero(d.desperdicioRealKg as string)} kg` },
    ];
  }
  if (alerta.tipo === 'DISCREPANCIA_TRANSFERENCIA') {
    const lineas = (d.lineas as { productoId: number; cantidadEnviada: string; cantidadRecibida: string; diferencia: string }[]) ?? [];
    const campos: CampoDetalle[] = [];
    for (const l of lineas) {
      if (Number(l.diferencia) === 0) continue;
      campos.push(
        { k: 'Producto', v: nombreProducto(l.productoId) },
        { k: 'Cantidad enviada', v: fmtNumero(l.cantidadEnviada) },
        { k: 'Cantidad recibida', v: fmtNumero(l.cantidadRecibida) },
        { k: 'Diferencia', v: fmtNumero(l.diferencia), destacado: true },
      );
    }
    campos.push(
      { k: 'Envió', v: nombreUsuario(d.usuarioEmisorId as number) },
      { k: 'Recibió', v: nombreUsuario(d.usuarioReceptorId as number) },
    );
    return campos;
  }
  return Object.entries(d).map(([k, v]) => ({ k, v: String(v) }));
}

export function Alertas() {
  const queryClient = useQueryClient();
  const alertas = useQuery({ queryKey: ['alertas'], queryFn: () => listarAlertas() });
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => listarProductos() });
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: listarUsuarios });

  const mutVista = useMutation({
    mutationFn: marcarVista,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alertas'] }),
  });

  const nombreProducto = (id: number) => productos.data?.find((p) => p.id === id)?.nombre ?? `#${id}`;
  const nombreUsuario = (id: number) => usuarios.data?.find((u) => u.id === id)?.nombre ?? `#${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-2xl font-extrabold">Alertas</h1>
        <div className="mt-1 text-sm text-texto-suave">Llegan en tiempo real (WebSocket). Solo vos ves esta pantalla.</div>
      </div>

      {alertas.isLoading && <div className="text-texto-suave">Cargando…</div>}
      {alertas.data?.length === 0 && <div className="text-texto-suave">No hay alertas.</div>}

      {alertas.data?.map((a) => {
        const estilo = ESTILO_TIPO[a.tipo] ?? { texto: a.tipo, color: '#5f6d60', bg: '#e6e9e2' };
        const campos = camposDeAlerta(a, nombreProducto, nombreUsuario);
        return (
          <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-5" style={{ opacity: a.vista ? 0.65 : 1 }}>
            <div className="flex items-center gap-3">
              <span
                className="rounded-lg px-2.5 py-1.5 text-[13px] font-extrabold tracking-wide"
                style={{ background: estilo.bg, color: estilo.color }}
              >
                {estilo.texto}
              </span>
              <span className="flex-1" />
              <span className="text-[13px] text-texto-suave">{fmtFechaHora(a.fechaHora)}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4.5 gap-y-2.5">
              {campos.map((c, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold text-texto-suave">{c.k}</div>
                  <div className="text-base font-bold" style={c.destacado ? { color: '#a02514' } : undefined}>
                    {c.v}
                  </div>
                </div>
              ))}
            </div>
            {!a.vista ? (
              <button
                type="button"
                onClick={() => mutVista.mutate(a.id)}
                className="w-fit min-h-11 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-sm font-bold text-primario hover:bg-chip"
              >
                Marcar como vista
              </button>
            ) : (
              <div className="text-[13px] font-semibold text-texto-suave">✓ Vista</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
