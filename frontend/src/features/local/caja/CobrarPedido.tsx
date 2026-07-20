import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TecladoNumerico } from '../../../components/ui/TecladoNumerico';
import { cobrarPedido } from '../../../api/pedidos';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import type { MedioPago, Pedido } from '../../../api/types';

interface Props {
  pedido: Pedido;
  onCobrado: (vuelto: string) => void;
  onCancelar: () => void;
}

const MEDIOS: { valor: MedioPago; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'MERCADO_PAGO', etiqueta: 'MP / QR' },
  { valor: 'DEBITO', etiqueta: 'Débito' },
  { valor: 'CREDITO', etiqueta: 'Crédito' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
];

// Cobro con medios combinables (§4.7). El vuelto sale SOLO del efectivo —
// misma regla que el backend (pedidos.calculos.ts): acá solo se anticipa
// visualmente, la autoridad es la respuesta del POST /cobrar.
export function CobrarPedido({ pedido, onCobrado, onCancelar }: Props) {
  const queryClient = useQueryClient();
  const [pagos, setPagos] = useState<{ medio: MedioPago; monto: number }[]>([]);
  const [medioEnCarga, setMedioEnCarga] = useState<MedioPago | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () => pedido.items.reduce((acc, i) => acc + Number(i.montoTotal), 0),
    [pedido.items],
  );
  const pagado = pagos.reduce((acc, p) => acc + p.monto, 0);
  const falta = Math.max(0, total - pagado);
  const efectivoRecibido = pagos.filter((p) => p.medio === 'EFECTIVO').reduce((a, p) => a + p.monto, 0);
  const vuelto = pagado > total ? pagado - total : 0;
  const vueltoImposible = vuelto > efectivoRecibido;

  const mutCobrar = useMutation({
    mutationFn: () => cobrarPedido(pedido.id, pagos),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      onCobrado(r.vuelto);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo cobrar. Probá de nuevo.'),
  });

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div className="flex max-h-[92vh] w-full flex-col gap-3.5 overflow-auto rounded-t-3xl bg-white p-5 sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-extrabold">Cobrar pedido #{pedido.id}</div>
          <div className="text-2xl font-extrabold text-primario">{fmtMoneda(total)}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {MEDIOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              onClick={() => setMedioEnCarga(m.valor)}
              className="min-h-[52px] cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-base font-bold text-texto hover:border-primario hover:text-primario"
            >
              + {m.etiqueta}
            </button>
          ))}
        </div>

        {pagos.length > 0 && (
          <div className="flex flex-col gap-2">
            {pagos.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-xl border border-borde bg-panel px-4 py-3">
                <div className="flex-1 text-base font-bold">
                  {MEDIOS.find((m) => m.valor === p.medio)?.etiqueta}
                </div>
                <div className="text-lg font-extrabold">{fmtMoneda(p.monto)}</div>
                <button
                  type="button"
                  onClick={() => setPagos((arr) => arr.filter((_, i) => i !== idx))}
                  className="cursor-pointer rounded-lg border border-borde-fuerte px-2.5 py-1 text-sm font-bold text-texto-suave"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-xl bg-chip px-4 py-3 text-base font-semibold">
          {falta > 0 ? (
            <div className="flex justify-between">
              <span>Falta</span>
              <span className="font-extrabold text-error-texto">{fmtMoneda(falta)}</span>
            </div>
          ) : (
            <div className="flex justify-between">
              <span>Vuelto</span>
              <span className="text-xl font-extrabold text-primario">{fmtMoneda(vuelto)}</span>
            </div>
          )}
        </div>

        {vueltoImposible && (
          <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">
            El vuelto no puede salir de un medio electrónico. Ajustá los montos.
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancelar}
            className="min-h-[60px] flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pagos.length === 0 || falta > 0 || vueltoImposible || mutCobrar.isPending}
            onClick={() => {
              setError(null);
              mutCobrar.mutate();
            }}
            className="min-h-[60px] flex-[2] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutCobrar.isPending ? 'COBRANDO…' : 'COBRAR'}
          </button>
        </div>

        {medioEnCarga && (
          <TecladoNumerico
            titulo={`¿Cuánto paga con ${MEDIOS.find((m) => m.valor === medioEnCarga)?.etiqueta}?`}
            subtitulo={falta > 0 ? `Faltan ${fmtMoneda(falta)}` : undefined}
            unidad="$"
            permiteDecimal
            onCancelar={() => setMedioEnCarga(null)}
            onConfirmar={(monto) => {
              setPagos((arr) => [...arr, { medio: medioEnCarga, monto }]);
              setMedioEnCarga(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
