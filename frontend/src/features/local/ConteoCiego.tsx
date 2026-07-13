import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { intentarRecepcion } from '../../api/transferencias';
import { fmtNumero } from '../../lib/formato';
import type { Transferencia } from '../../api/types';

interface Props {
  transferencia: Transferencia;
  valores: Record<number, number>;
  onCambiarValores: (valores: Record<number, number>) => void;
  onVolver: () => void;
  onCoincide: () => void;
  onNoCoincide: () => void;
}

export function ConteoCiego({ transferencia, valores, onCambiarValores, onVolver, onCoincide, onNoCoincide }: Props) {
  const queryClient = useQueryClient();
  const [productoEnCarga, setProductoEnCarga] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todasCargadas = transferencia.lineas.every((l) => valores[l.productoId] !== undefined);

  const mutConfirmar = useMutation({
    mutationFn: () =>
      intentarRecepcion(
        transferencia.id,
        transferencia.lineas.map((l) => ({ productoId: l.productoId, cantidadRecibida: valores[l.productoId] })),
      ),
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      if (resultado.coincide) onCoincide();
      else onNoCoincide();
    },
    onError: () => setError('No se pudo registrar el conteo. Probá de nuevo.'),
  });

  const lineaEnCarga = productoEnCarga != null ? transferencia.lineas.find((l) => l.productoId === productoEnCarga) : null;

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[10px] border border-borde-fuerte bg-white text-xl"
        >
          ‹
        </button>
        <div>
          <div className="text-[22px] font-extrabold">Contá y cargá cuántas unidades llegaron</div>
          <div className="text-[15px] text-texto-suave">
            T-{String(transferencia.id).padStart(5, '0')} · desde {transferencia.sucursalOrigen}
          </div>
        </div>
      </div>

      {transferencia.lineas.map((l) => {
        const valor = valores[l.productoId];
        return (
          <div key={l.id} className="flex items-center gap-4.5 rounded-2xl border border-borde bg-white px-5 py-4.5">
            <div className="flex-1 text-xl font-extrabold">{l.producto}</div>
            {valor !== undefined ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl font-extrabold">{fmtNumero(valor, 0)}</span>
                <button
                  type="button"
                  onClick={() => setProductoEnCarga(l.productoId)}
                  className="min-h-12 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-[15px] font-bold text-primario"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setProductoEnCarga(l.productoId)}
                className="min-h-[58px] cursor-pointer rounded-2xl border-2 border-primario bg-white px-6.5 text-lg font-extrabold text-primario hover:bg-chip"
              >
                CARGAR
              </button>
            )}
          </div>
        );
      })}

      {error && <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>}

      <div className="flex-1" />

      <button
        type="button"
        disabled={!todasCargadas || mutConfirmar.isPending}
        onClick={() => {
          setError(null);
          mutConfirmar.mutate();
        }}
        className="min-h-16 w-full cursor-pointer rounded-[20px] bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
      >
        {mutConfirmar.isPending ? 'CONFIRMANDO…' : 'CONFIRMAR CONTEO'}
      </button>

      {lineaEnCarga && (
        <TecladoNumerico
          titulo="¿Cuántas unidades llegaron?"
          subtitulo={lineaEnCarga.producto}
          unidad="u"
          permiteDecimal={false}
          permiteCero
          onCancelar={() => setProductoEnCarga(null)}
          onConfirmar={(valor) => {
            onCambiarValores({ ...valores, [lineaEnCarga.productoId]: valor });
            setProductoEnCarga(null);
          }}
        />
      )}
    </div>
  );
}
