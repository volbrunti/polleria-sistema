import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { PantallaExito } from '../../components/ui/PantallaExito';
import { obtenerLote, cerrarLote } from '../../api/produccion';
import { ApiError } from '../../api/client';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';

interface Props {
  loteId: number;
  onVolverMenu: () => void;
  onCerrado: () => void;
}

type Overlay = { tipo: 'unidades' } | { tipo: 'desperdicio'; unidades: number } | null;

export function LoteAbierto({ loteId, onVolverMenu, onCerrado }: Props) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<number | null>(null);

  const lote = useQuery({ queryKey: ['lote', loteId], queryFn: () => obtenerLote(loteId) });

  const mutCerrar = useMutation({
    mutationFn: (datos: { unidadesProducidasReales: number; desperdicioRealKg: number }) => cerrarLote(loteId, datos),
    onSuccess: (_, variables) => {
      setResultado(variables.unidadesProducidasReales);
      setOverlay(null);
    },
    onError: (err) => {
      setErrorEnvio(err instanceof ApiError ? err.message : 'No se pudo cerrar el lote.');
      setOverlay(null);
    },
  });

  if (resultado != null) {
    return (
      <PantallaExito
        titulo="Lote cerrado"
        subtitulo={`Se produjeron ${fmtNumero(resultado)} unidades de ${lote.data?.productoElaborado ?? ''}.`}
        onContinuar={onCerrado}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-5">
      <button
        type="button"
        onClick={onVolverMenu}
        className="min-h-11 w-fit cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-3.5 text-sm font-semibold text-texto-suave"
      >
        ‹ Menú
      </button>

      {lote.isLoading && <div className="text-texto-suave">Cargando lote…</div>}

      {lote.data && (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-5">
          <div className="w-fit rounded-lg bg-[#fff7d9] px-2.5 py-1.5 text-[13px] font-extrabold tracking-wide text-advertencia-texto">
            LOTE ABIERTO
          </div>
          <div className="text-2xl font-extrabold">{lote.data.productoElaborado}</div>
          <div className="text-[15px] text-texto-suave">
            Lote {lote.data.id} · empezó {fmtFechaHora(lote.data.fechaHora)}
          </div>
          <div className="flex flex-col gap-2 border-t border-borde pt-3">
            <div className="text-sm font-bold text-texto-suave">INSUMOS DEL LOTE</div>
            {lote.data.insumosUsados?.map((i) => (
              <div key={i.id} className="text-base">
                {i.productoInsumo?.nombre} — {fmtNumero(i.cantidadUsada)}{' '}
                {i.productoInsumo?.unidadDeMedida.toLowerCase()}
              </div>
            ))}
          </div>
        </div>
      )}

      {errorEnvio && (
        <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">
          {errorEnvio}
        </div>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setOverlay({ tipo: 'unidades' })}
        className="min-h-19 w-full cursor-pointer rounded-[20px] bg-primario text-xl font-extrabold text-white hover:bg-primario-hover"
      >
        TERMINÉ — CARGAR RESULTADO
      </button>

      {overlay?.tipo === 'unidades' && (
        <TecladoNumerico
          titulo="¿Cuántas unidades salieron?"
          unidad="u"
          permiteDecimal={false}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(unidades) => setOverlay({ tipo: 'desperdicio', unidades })}
        />
      )}

      {overlay?.tipo === 'desperdicio' && (
        <TecladoNumerico
          titulo="¿Cuántos kg tiraste?"
          subtitulo="Desperdicio del lote (puede ser 0)"
          unidad="kg"
          permiteCero
          onCancelar={() => setOverlay(null)}
          onConfirmar={(desperdicio) => {
            setErrorEnvio(null);
            mutCerrar.mutate({ unidadesProducidasReales: overlay.unidades, desperdicioRealKg: desperdicio });
          }}
        />
      )}
    </div>
  );
}
