import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TecladoNumerico } from '../../../components/ui/TecladoNumerico';
import { cobrarPedido } from '../../../api/pedidos';
import { listarRecargos } from '../../../api/recargos';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import type { MedioPago, Pedido, RecargoTarjeta } from '../../../api/types';

interface Props {
  pedido: Pedido;
  onCobrado: (vuelto: string) => void;
  onCancelar: () => void;
}

interface PagoUI {
  medio: MedioPago;
  /** Lo que cubre el pedido. */
  monto: number;
  /** Extra por usar la tarjeta; 0 = sin recargo. */
  recargoPct: number;
  recargoNombre?: string;
}

const MEDIOS: { valor: MedioPago; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'MERCADO_PAGO', etiqueta: 'MP / QR' },
  { valor: 'DEBITO', etiqueta: 'Débito' },
  { valor: 'CREDITO', etiqueta: 'Crédito' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
];

// Solo el plástico tiene arancel — el efectivo y el QR no llevan recargo.
const LLEVA_RECARGO: MedioPago[] = ['DEBITO', 'CREDITO'];

const etiquetaDe = (medio: MedioPago) => MEDIOS.find((m) => m.valor === medio)?.etiqueta ?? medio;

// Cobro con medios combinables (§4.7). El vuelto sale SOLO del efectivo —
// misma regla que el backend (pedidos.calculos.ts): acá solo se anticipa
// visualmente, la autoridad es la respuesta del POST /cobrar.
//
// Recargo de tarjeta (reunión 4/8): al elegir débito o crédito se abre la
// lista de porcentajes que cargó el admin. El recargo es plata EXTRA sobre el
// total del pedido — el pedido sigue cerrando contra la suma de los `monto`.
export function CobrarPedido({ pedido, onCobrado, onCancelar }: Props) {
  const queryClient = useQueryClient();
  const [pagos, setPagos] = useState<PagoUI[]>([]);
  const [medioEnCarga, setMedioEnCarga] = useState<MedioPago | null>(null);
  const [eligiendoRecargo, setEligiendoRecargo] = useState<MedioPago | null>(null);
  const [recargoElegido, setRecargoElegido] = useState<{ pct: number; nombre?: string }>({ pct: 0 });
  const [error, setError] = useState<string | null>(null);

  const recargosQ = useQuery({
    queryKey: ['recargos-tarjeta'],
    queryFn: () => listarRecargos(),
    staleTime: 10 * 60 * 1000,
  });

  const total = useMemo(
    () => pedido.items.reduce((acc, i) => acc + Number(i.montoTotal), 0),
    [pedido.items],
  );
  const pagado = pagos.reduce((acc, p) => acc + p.monto, 0);
  const falta = Math.max(0, total - pagado);
  const efectivoRecibido = pagos.filter((p) => p.medio === 'EFECTIVO').reduce((a, p) => a + p.monto, 0);
  const vuelto = pagado > total ? pagado - total : 0;
  const vueltoImposible = vuelto > efectivoRecibido;
  const recargoTotal = pagos.reduce((acc, p) => acc + (p.monto * p.recargoPct) / 100, 0);
  const totalConRecargo = total + recargoTotal;

  const mutCobrar = useMutation({
    mutationFn: () =>
      cobrarPedido(
        pedido.id,
        pagos.map((p) => ({
          medio: p.medio,
          monto: p.monto,
          ...(p.recargoPct > 0 ? { recargoPct: p.recargoPct } : {}),
        })),
      ),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      onCobrado(r.vuelto);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo cobrar. Probá de nuevo.'),
  });

  // Elegir medio: con tarjeta primero se pregunta el recargo, después el monto.
  function elegirMedio(medio: MedioPago) {
    setRecargoElegido({ pct: 0 });
    if (LLEVA_RECARGO.includes(medio)) setEligiendoRecargo(medio);
    else setMedioEnCarga(medio);
  }

  const opcionesRecargo = (recargosQ.data ?? []).filter((r) => r.medio === eligiendoRecargo);

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
              onClick={() => elegirMedio(m.valor)}
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
                <div className="flex-1">
                  <div className="text-base font-bold">{etiquetaDe(p.medio)}</div>
                  {p.recargoPct > 0 && (
                    <div className="text-[13px] font-semibold text-advertencia-texto">
                      {p.recargoNombre ?? 'Recargo'} +{p.recargoPct}% ={' '}
                      {fmtMoneda((p.monto * p.recargoPct) / 100)}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-extrabold">{fmtMoneda(p.monto)}</div>
                  {p.recargoPct > 0 && (
                    <div className="text-[13px] font-bold text-texto-suave">
                      cobrar {fmtMoneda(p.monto * (1 + p.recargoPct / 100))}
                    </div>
                  )}
                </div>
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
          {recargoTotal > 0 && (
            <div className="mt-1 flex justify-between border-t border-borde pt-2">
              <span>Con recargo, el cliente paga</span>
              <span className="text-xl font-extrabold text-advertencia-texto">
                {fmtMoneda(totalConRecargo)}
              </span>
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

        {eligiendoRecargo && (
          <SelectorRecargo
            medio={eligiendoRecargo}
            opciones={opcionesRecargo}
            cargando={recargosQ.isLoading}
            onCancelar={() => setEligiendoRecargo(null)}
            onElegir={(pct, nombre) => {
              setRecargoElegido({ pct, nombre });
              setMedioEnCarga(eligiendoRecargo);
              setEligiendoRecargo(null);
            }}
          />
        )}

        {medioEnCarga && (
          <TecladoNumerico
            titulo={`¿Cuánto paga con ${etiquetaDe(medioEnCarga)}?`}
            subtitulo={
              recargoElegido.pct > 0
                ? `Poné el monto SIN el recargo — el +${recargoElegido.pct}% lo suma el sistema`
                : falta > 0
                  ? `Faltan ${fmtMoneda(falta)}`
                  : undefined
            }
            unidad="$"
            permiteDecimal
            onCancelar={() => setMedioEnCarga(null)}
            onConfirmar={(monto) => {
              setPagos((arr) => [
                ...arr,
                {
                  medio: medioEnCarga,
                  monto,
                  recargoPct: recargoElegido.pct,
                  recargoNombre: recargoElegido.nombre,
                },
              ]);
              setMedioEnCarga(null);
              setRecargoElegido({ pct: 0 });
            }}
          />
        )}
      </div>
    </div>
  );
}

// Lista de porcentajes que cargó el admin, más "sin recargo" siempre visible
// arriba: la mayoría de las veces el cliente paga sin adicional.
function SelectorRecargo({
  medio,
  opciones,
  cargando,
  onElegir,
  onCancelar,
}: {
  medio: MedioPago;
  opciones: RecargoTarjeta[];
  cargando: boolean;
  onElegir: (pct: number, nombre?: string) => void;
  onCancelar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div className="flex max-h-[85vh] w-full flex-col gap-2.5 overflow-auto rounded-t-3xl bg-white p-5 sm:max-w-md sm:rounded-3xl">
        <div className="text-xl font-extrabold">¿Qué recargo tiene esta tarjeta?</div>
        <div className="text-[15px] text-texto-suave">{etiquetaDe(medio)}</div>

        <button
          type="button"
          onClick={() => onElegir(0)}
          className="min-h-[60px] w-full cursor-pointer rounded-2xl border-2 border-primario bg-white text-lg font-extrabold text-primario"
        >
          SIN RECARGO
        </button>

        {cargando && <div className="py-3 text-center text-texto-suave">Cargando…</div>}
        {!cargando && opciones.length === 0 && (
          <div className="rounded-xl bg-chip px-4 py-3 text-[15px] text-texto-suave">
            El administrador todavía no cargó recargos para {etiquetaDe(medio).toLowerCase()}.
          </div>
        )}

        {opciones.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onElegir(Number(r.porcentaje), r.nombre)}
            className="flex min-h-[60px] w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-borde-fuerte bg-white px-4 text-left hover:border-acento"
          >
            <span className="text-base font-bold">{r.nombre}</span>
            <span className="text-xl font-extrabold text-advertencia-texto">+{Number(r.porcentaje)}%</span>
          </button>
        ))}

        <button
          type="button"
          onClick={onCancelar}
          className="mt-1 min-h-[52px] w-full cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
