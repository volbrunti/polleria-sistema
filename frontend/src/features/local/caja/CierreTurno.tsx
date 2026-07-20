import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TecladoNumerico } from '../../../components/ui/TecladoNumerico';
import { cerrarTurno } from '../../../api/turnos';
import { useAuth } from '../../../auth/AuthContext';
import { fmtMoneda, fmtNumero } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import type { CierreResultado } from '../../../api/types';

interface Props {
  sucursalId: number;
  onCancelar: () => void;
}

type Campo = 'efectivo' | 'pollos' | null;

// Cierre (CLAUDE-MODULO-2.md §5.3): arqueo doble ciego idéntico a la
// apertura. El cajero recibe SOLO el resumen por unidades — sin plata, sin
// diferencia, sin esperado. Al terminar, la sesión se cierra sola.
export function CierreTurno({ sucursalId, onCancelar }: Props) {
  const { salir } = useAuth();
  const [efectivo, setEfectivo] = useState<number | null>(null);
  const [pollos, setPollos] = useState<number | null>(null);
  const [campoEnCarga, setCampoEnCarga] = useState<Campo>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<CierreResultado | null>(null);

  const mutCerrar = useMutation({
    mutationFn: () =>
      cerrarTurno({ sucursalId, conteoEfectivo: efectivo!, conteoPollosMarcados: pollos! }),
    onSuccess: (r) => setResultado(r),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo cerrar el turno.'),
  });

  // ── Resumen post-cierre: unidades vendidas, sin datos financieros ──
  if (resultado) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-panel">
        <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-6">
          <div className="flex h-16 w-16 items-center justify-center self-center rounded-full bg-primario text-3xl font-extrabold text-white">
            ✓
          </div>
          <div className="text-center text-[24px] font-extrabold">Turno cerrado</div>

          <div className="rounded-2xl border border-borde bg-white p-4">
            <div className="mb-2 text-base font-extrabold text-texto-suave">Ventas del turno (unidades)</div>
            {resultado.ventasPorUnidad.length === 0 ? (
              <div className="text-[15px] text-texto-suave">No hubo ventas en este turno.</div>
            ) : (
              resultado.ventasPorUnidad.map((v) => (
                <div key={v.productoId} className="flex justify-between border-b border-borde py-2 text-base last:border-0">
                  <span className="font-semibold">{v.producto}</span>
                  <span className="font-extrabold">{fmtNumero(v.unidades, 1)}</span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-borde bg-white px-4 py-3.5">
            <span className="text-base font-semibold">Pollos marcados que quedan</span>
            <span className="text-xl font-extrabold">{fmtNumero(resultado.pollosMarcadosContados, 1)}</span>
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => void salir()}
            className="min-h-16 w-full cursor-pointer rounded-[20px] bg-primario text-xl font-extrabold text-white hover:bg-primario-hover"
          >
            CERRAR SESIÓN
          </button>
        </div>
      </div>
    );
  }

  // ── Arqueo doble ciego de cierre ──
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-panel">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <div>
          <div className="text-[26px] font-extrabold">Cierre de turno</div>
          <div className="text-base text-texto-suave">
            Contá lo que hay físicamente y cargá los dos valores para cerrar.
          </div>
        </div>

        {(
          [
            ['efectivo', 'Efectivo en caja', 'Billetes y monedas, todo lo que haya', efectivo, (v: number | null) => v != null ? fmtMoneda(v) : ''] as const,
            ['pollos', 'Pollos marcados', 'Los que quedan en la parrilla', pollos, (v: number | null) => v != null ? fmtNumero(v, 1) : ''] as const,
          ]
        ).map(([campo, titulo, detalle, valor, formatear]) => (
          <div key={campo} className="flex items-center gap-4.5 rounded-2xl border border-borde bg-white px-5 py-5">
            <div className="flex-1">
              <div className="text-xl font-extrabold">{titulo}</div>
              <div className="text-[15px] text-texto-suave">{detalle}</div>
            </div>
            {valor != null ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl font-extrabold">{formatear(valor)}</span>
                <button
                  type="button"
                  onClick={() => setCampoEnCarga(campo)}
                  className="min-h-12 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-[15px] font-bold text-primario"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCampoEnCarga(campo)}
                className="min-h-[58px] cursor-pointer rounded-2xl border-2 border-primario bg-white px-6.5 text-lg font-extrabold text-primario hover:bg-chip"
              >
                CARGAR
              </button>
            )}
          </div>
        ))}

        {error && (
          <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>
        )}

        <div className="flex-1" />

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancelar}
            className="min-h-16 flex-1 cursor-pointer rounded-[20px] border-2 border-borde-fuerte bg-white text-lg font-bold text-texto-suave"
          >
            Volver
          </button>
          <button
            type="button"
            disabled={efectivo == null || pollos == null || mutCerrar.isPending}
            onClick={() => {
              setError(null);
              mutCerrar.mutate();
            }}
            className="min-h-16 flex-[2] cursor-pointer rounded-[20px] bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutCerrar.isPending ? 'CERRANDO…' : 'CERRAR TURNO'}
          </button>
        </div>
      </div>

      {campoEnCarga === 'efectivo' && (
        <TecladoNumerico
          titulo="¿Cuánto efectivo hay en la caja?"
          unidad="$"
          permiteDecimal
          permiteCero
          onCancelar={() => setCampoEnCarga(null)}
          onConfirmar={(v) => {
            setEfectivo(v);
            setCampoEnCarga(null);
          }}
        />
      )}
      {campoEnCarga === 'pollos' && (
        <TecladoNumerico
          titulo="¿Cuántos pollos marcados quedan?"
          subtitulo="Medio pollo = 0,5"
          unidad="u"
          permiteDecimal
          permiteCero
          onCancelar={() => setCampoEnCarga(null)}
          onConfirmar={(v) => {
            setPollos(v);
            setCampoEnCarga(null);
          }}
        />
      )}
    </div>
  );
}
