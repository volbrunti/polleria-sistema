import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TecladoNumerico } from '../../../components/ui/TecladoNumerico';
import { abrirTurno } from '../../../api/turnos';
import { fmtMoneda, fmtNumero } from '../../../lib/formato';
import { ApiError } from '../../../api/client';

interface Props {
  sucursalId: number;
  onResuelto: () => void; // refetch del turno activo (quedó ABIERTO o BLOQUEADO)
}

type Campo = 'efectivo' | 'pollos' | null;

// Arqueo DOBLE y CIEGO de apertura (CLAUDE-MODULO-2.md §5.1): pantalla
// neutral, solo los dos campos. Sin saldos anteriores, sin sugerencias, sin
// totales del turno anterior. La comparación vive en el backend.
export function AperturaTurno({ sucursalId, onResuelto }: Props) {
  const [efectivo, setEfectivo] = useState<number | null>(null);
  const [pollos, setPollos] = useState<number | null>(null);
  const [campoEnCarga, setCampoEnCarga] = useState<Campo>(null);
  const [error, setError] = useState<string | null>(null);

  const mutAbrir = useMutation({
    mutationFn: () =>
      abrirTurno({ sucursalId, conteoEfectivo: efectivo!, conteoPollosMarcados: pollos! }),
    onSuccess: () => onResuelto(),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo abrir el turno. Probá de nuevo.'),
  });

  const listo = efectivo != null && pollos != null;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
      <div>
        <div className="text-[26px] font-extrabold">Apertura de turno</div>
        <div className="text-base text-texto-suave">
          Contá lo que hay físicamente y cargá los dos valores para empezar a vender.
        </div>
      </div>

      <div className="flex items-center gap-4.5 rounded-2xl border border-borde bg-white px-5 py-5">
        <div className="flex-1">
          <div className="text-xl font-extrabold">Efectivo en caja</div>
          <div className="text-[15px] text-texto-suave">Billetes y monedas, todo lo que haya</div>
        </div>
        {efectivo != null ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-extrabold">{fmtMoneda(efectivo)}</span>
            <button
              type="button"
              onClick={() => setCampoEnCarga('efectivo')}
              className="min-h-12 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-[15px] font-bold text-primario"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCampoEnCarga('efectivo')}
            className="min-h-[58px] cursor-pointer rounded-2xl border-2 border-primario bg-white px-6.5 text-lg font-extrabold text-primario hover:bg-chip"
          >
            CARGAR
          </button>
        )}
      </div>

      <div className="flex items-center gap-4.5 rounded-2xl border border-borde bg-white px-5 py-5">
        <div className="flex-1">
          <div className="text-xl font-extrabold">Pollos marcados</div>
          <div className="text-[15px] text-texto-suave">Los que están en la parrilla ahora</div>
        </div>
        {pollos != null ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-extrabold">{fmtNumero(pollos, 1)}</span>
            <button
              type="button"
              onClick={() => setCampoEnCarga('pollos')}
              className="min-h-12 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-[15px] font-bold text-primario"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCampoEnCarga('pollos')}
            className="min-h-[58px] cursor-pointer rounded-2xl border-2 border-primario bg-white px-6.5 text-lg font-extrabold text-primario hover:bg-chip"
          >
            CARGAR
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>
      )}

      <div className="flex-1" />

      <button
        type="button"
        disabled={!listo || mutAbrir.isPending}
        onClick={() => {
          setError(null);
          mutAbrir.mutate();
        }}
        className="min-h-16 w-full cursor-pointer rounded-[20px] bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
      >
        {mutAbrir.isPending ? 'ABRIENDO…' : 'ABRIR TURNO'}
      </button>

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
          titulo="¿Cuántos pollos marcados hay?"
          subtitulo="Contá los de la parrilla (medio pollo = 0,5)"
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
