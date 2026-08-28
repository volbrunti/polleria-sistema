import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { PantallaExito } from '../../components/ui/PantallaExito';
import { obtenerLote, cerrarLote } from '../../api/produccion';
import { ApiError } from '../../api/client';
import { fmtFechaHora, fmtNumero, fmtUnidad } from '../../lib/formato';

interface Props {
  loteId: number;
  onVolverMenu: () => void;
  onCerrado: () => void;
}

type Overlay =
  | { tipo: 'unidades' }
  | { tipo: 'desperdicio'; unidades: number }
  | { tipo: 'editarInsumo'; insumoUsadoId: number; nombre: string; unidad: string; actual: number }
  | null;

export function LoteAbierto({ loteId, onVolverMenu, onCerrado }: Props) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<number | null>(null);
  // Correcciones de lo REALMENTE usado, por id de InsumoUsado. Vacío = se usó
  // exactamente lo estimado al abrir el lote.
  const [reales, setReales] = useState<Record<number, number>>({});

  const lote = useQuery({ queryKey: ['lote', loteId], queryFn: () => obtenerLote(loteId) });

  const mutCerrar = useMutation({
    mutationFn: (datos: { unidadesProducidasReales: number; desperdicioRealKg: number }) =>
      cerrarLote(loteId, {
        ...datos,
        insumosReales: Object.entries(reales).map(([id, cantidadUsada]) => ({
          insumoUsadoId: Number(id),
          cantidadUsada,
        })),
      }),
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
            <div className="-mt-1 text-sm text-texto-suave">
              Si usaste más o menos de lo que habías cargado, corregilo con ✎ antes de terminar.
            </div>
            {lote.data.insumosUsados?.map((i) => {
              const unidad = i.productoInsumo?.unidadDeMedida.toLowerCase() ?? '';
              const estimado = Number(i.cantidadUsada);
              const corregido = reales[i.id];
              const valor = corregido ?? estimado;
              return (
                <div key={i.id} className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-base">
                      {i.productoInsumo?.nombre} — {fmtNumero(valor)} {fmtUnidad(unidad, valor)}
                    </div>
                    {corregido != null && corregido !== estimado && (
                      <div className="text-sm font-semibold text-advertencia-texto">
                        habías cargado {fmtNumero(estimado)} {fmtUnidad(unidad, estimado)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Corregir ${i.productoInsumo?.nombre}`}
                    onClick={() =>
                      setOverlay({
                        tipo: 'editarInsumo',
                        insumoUsadoId: i.id,
                        nombre: i.productoInsumo?.nombre ?? 'Insumo',
                        unidad,
                        actual: valor,
                      })
                    }
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-borde-fuerte bg-white text-base hover:bg-chip"
                  >
                    ✎
                  </button>
                </div>
              );
            })}
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

      {overlay?.tipo === 'editarInsumo' && (
        <TecladoNumerico
          titulo={`¿Cuánto usaste realmente de ${overlay.nombre}?`}
          subtitulo="Pesá lo que quedó y cargá lo que gastaste de verdad."
          variante="contraste"
          unidad={overlay.unidad === 'kg' ? 'kg' : 'u'}
          permiteDecimal={overlay.unidad === 'kg'}
          permiteCero
          valorInicial={overlay.actual}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            setReales((r) => ({ ...r, [overlay.insumoUsadoId]: cantidad }));
            setOverlay(null);
          }}
        />
      )}

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
