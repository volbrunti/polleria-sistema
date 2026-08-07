import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  anularPedido,
  listarPendientes,
  marcarListo,
  marcarNoRetirado,
  marcarPerdido,
  reasignarPedido,
} from '../../../api/pedidos';
import { fmtFechaHora, fmtMoneda, fmtNumero } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import { CobrarPedido } from './CobrarPedido';
import { ModificarPedido } from './ModificarPedido';
import type { Pedido } from '../../../api/types';

interface Props {
  sucursalId: number;
}

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string; bg: string }> = {
  EN_PREPARACION: { texto: 'En preparación', color: '#7a5d00', bg: '#fff7d9' },
  LISTO: { texto: 'Listo', color: '#1a7f3f', bg: '#e3f4e9' },
  LISTO_NO_RETIRADO: { texto: 'No retirado', color: '#a13333', bg: '#fdeaea' },
};

// Ciclo de vida §4.4: EN_PREPARACION → LISTO → ENTREGADO/LISTO_NO_RETIRADO →
// REASIGNADO/PERDIDO. Anulable en cualquier estado antes de ENTREGADO/PERDIDO.
export function PedidosActivos({ sucursalId }: Props) {
  const queryClient = useQueryClient();
  const [pedidoACobrar, setPedidoACobrar] = useState<Pedido | null>(null);
  const [pedidoAModificar, setPedidoAModificar] = useState<Pedido | null>(null);
  const [vuelto, setVuelto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<{ accion: 'anular' | 'perdido'; pedido: Pedido } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedidosQ = useQuery({
    queryKey: ['pedidos', 'pendientes', sucursalId],
    queryFn: () => listarPendientes(sucursalId),
    refetchInterval: 30_000,
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
  }

  function alError(e: unknown) {
    setError(e instanceof ApiError ? e.message : 'No se pudo completar la acción.');
  }

  const mutListo = useMutation({ mutationFn: marcarListo, onSuccess: invalidar, onError: alError });
  const mutNoRetirado = useMutation({ mutationFn: marcarNoRetirado, onSuccess: invalidar, onError: alError });
  const mutReasignar = useMutation({ mutationFn: reasignarPedido, onSuccess: invalidar, onError: alError });
  const mutPerdido = useMutation({
    mutationFn: marcarPerdido,
    onSuccess: () => {
      invalidar();
      setConfirmando(null);
    },
    onError: alError,
  });
  const mutAnular = useMutation({
    mutationFn: anularPedido,
    onSuccess: () => {
      invalidar();
      setConfirmando(null);
    },
    onError: alError,
  });

  const pedidos = pedidosQ.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="text-[22px] font-extrabold">Pedidos activos</div>

      {error && (
        <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>
      )}

      {pedidosQ.isLoading ? (
        <div className="p-6 text-center text-texto-suave">Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div className="rounded-2xl border border-borde bg-white p-8 text-center text-lg text-texto-suave">
          No hay pedidos pendientes.
        </div>
      ) : (
        pedidos.map((p) => {
          const etiqueta = ETIQUETA_ESTADO[p.estado] ?? { texto: p.estado, color: '#555', bg: '#eee' };
          const total = p.items.reduce((acc, i) => acc + Number(i.montoTotal), 0);
          const ocupado =
            mutListo.isPending || mutNoRetirado.isPending || mutReasignar.isPending;
          return (
            <div key={p.id} className="rounded-2xl border border-borde bg-white px-4.5 py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-lg font-extrabold">#{p.id}</span>
                <span
                  className="rounded-lg px-2.5 py-1 text-[13px] font-bold"
                  style={{ color: etiqueta.color, background: etiqueta.bg }}
                >
                  {etiqueta.texto}
                </span>
                <span className="rounded-lg bg-chip px-2.5 py-1 text-[13px] font-bold text-texto-suave">
                  {p.tipo === 'PRESENCIAL' ? 'Presencial' : 'A retirar'}
                </span>
                <span className="text-sm text-texto-suave">{fmtFechaHora(p.fechaCreacion)}</span>
                <span className="ml-auto text-lg font-extrabold">{fmtMoneda(total)}</span>
              </div>

              <div className="mt-2 flex flex-col gap-0.5">
                {p.items.map((i) => (
                  <div key={i.id} className="flex justify-between text-[15px]">
                    <span>
                      {fmtNumero(i.cantidad, 1)} × {i.producto?.nombre}
                      {i.aclaraciones && <span className="text-texto-suave"> — {i.aclaraciones}</span>}
                    </span>
                    <span className="font-semibold">{fmtMoneda(i.montoTotal)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {p.estado === 'EN_PREPARACION' && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => mutListo.mutate(p.id)}
                    className="min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
                  >
                    MARCAR LISTO
                  </button>
                )}
                {(p.estado === 'EN_PREPARACION' || p.estado === 'LISTO') && (
                  <button
                    type="button"
                    onClick={() => setPedidoACobrar(p)}
                    className="min-h-12 cursor-pointer rounded-xl border-2 border-primario bg-white px-5 text-[15px] font-extrabold text-primario hover:bg-chip"
                  >
                    COBRAR
                  </button>
                )}
                {(p.estado === 'EN_PREPARACION' || p.estado === 'LISTO') && (
                  <button
                    type="button"
                    onClick={() => setPedidoAModificar(p)}
                    className="min-h-12 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-5 text-[15px] font-bold text-texto-suave"
                  >
                    Modificar
                  </button>
                )}
                {p.estado === 'LISTO' && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => mutNoRetirado.mutate(p.id)}
                    className="min-h-12 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-5 text-[15px] font-bold text-texto-suave"
                  >
                    No lo retiraron
                  </button>
                )}
                {p.estado === 'LISTO_NO_RETIRADO' && (
                  <>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => mutReasignar.mutate(p.id)}
                      className="min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
                    >
                      REASIGNAR A OTRO CLIENTE
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmando({ accion: 'perdido', pedido: p })}
                      className="min-h-12 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-5 text-[15px] font-bold text-error-texto"
                    >
                      Se perdió
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmando({ accion: 'anular', pedido: p })}
                  className="ml-auto min-h-12 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-5 text-[15px] font-bold text-error-texto"
                >
                  Anular
                </button>
              </div>
            </div>
          );
        })
      )}

      {pedidoACobrar && (
        <CobrarPedido
          pedido={pedidoACobrar}
          onCobrado={(v) => {
            setPedidoACobrar(null);
            setVuelto(v);
          }}
          onCancelar={() => setPedidoACobrar(null)}
        />
      )}

      {pedidoAModificar && (
        <ModificarPedido pedido={pedidoAModificar} onCerrar={() => setPedidoAModificar(null)} />
      )}

      {vuelto !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">Pedido cobrado ✓</div>
            {Number(vuelto) > 0 && (
              <>
                <div className="text-base text-texto-suave">Vuelto</div>
                <div className="text-4xl font-extrabold text-primario">{fmtMoneda(vuelto)}</div>
              </>
            )}
            <button
              type="button"
              onClick={() => setVuelto(null)}
              className="mt-1 min-h-[56px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white"
            >
              LISTO
            </button>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white p-5">
            <div className="text-xl font-extrabold">
              {confirmando.accion === 'anular'
                ? `¿Anular el pedido #${confirmando.pedido.id}?`
                : `¿Marcar el pedido #${confirmando.pedido.id} como perdido?`}
            </div>
            <div className="text-base text-texto-suave">
              {confirmando.accion === 'anular'
                ? 'Se avisa a cocina y el stock vuelve. Queda registrado.'
                : 'El producto se descarta. Queda registrado como pérdida.'}
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                className="min-h-[56px] flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={mutAnular.isPending || mutPerdido.isPending}
                onClick={() =>
                  confirmando.accion === 'anular'
                    ? mutAnular.mutate(confirmando.pedido.id)
                    : mutPerdido.mutate(confirmando.pedido.id)
                }
                className="min-h-[56px] flex-[2] cursor-pointer rounded-2xl bg-error-texto text-lg font-extrabold text-white disabled:opacity-50"
              >
                {confirmando.accion === 'anular' ? 'ANULAR PEDIDO' : 'MARCAR PERDIDO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
