import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmarConDiscrepancia } from '../../api/transferencias';

type Props =
  | { variante: 'ok'; onListo: () => void }
  | { variante: 'registrado'; onListo: () => void }
  | {
      variante: 'diff';
      transferenciaId: number;
      valores: Record<number, number>;
      onRecontar: () => void;
      onConfirmado: () => void;
    };

// Réplica de las 3 pantallas de resultado del conteo: "coincide" (verde,
// celebratoria) vs. "no coincide"/"registrado" (neutrales — nunca se
// culpabiliza al cajero ni se revela de qué lado está el error).
export function ResultadoRecepcion(props: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutConfirmarIgual = useMutation({
    mutationFn: () => {
      if (props.variante !== 'diff') throw new Error('no aplica');
      const lineas = Object.entries(props.valores).map(([productoId, cantidadRecibida]) => ({
        productoId: Number(productoId),
        cantidadRecibida,
      }));
      return confirmarConDiscrepancia(props.transferenciaId, lineas);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      if (props.variante === 'diff') props.onConfirmado();
    },
    onError: () => setError('No se pudo registrar. Probá de nuevo.'),
  });

  if (props.variante === 'ok') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4.5 bg-primario px-7 py-7 text-center">
        <div className="animate-pop flex h-30 w-30 items-center justify-center rounded-full bg-white text-6xl font-extrabold text-primario">
          ✓
        </div>
        <div className="text-[30px] font-extrabold text-white">Todo en orden.</div>
        <div className="text-lg text-white/85">Mercadería ingresada.</div>
        <button
          type="button"
          onClick={props.onListo}
          className="mt-2.5 min-h-15 min-w-[220px] cursor-pointer rounded-2xl bg-white text-lg font-extrabold text-primario"
        >
          LISTO
        </button>
      </div>
    );
  }

  if (props.variante === 'registrado') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4.5 px-7 py-7 text-center">
        <div className="animate-pop flex h-26 w-26 items-center justify-center rounded-full bg-[#e6e9e2] text-[48px] font-extrabold text-texto">
          ✓
        </div>
        <div className="text-2xl font-extrabold">Listo. Tu conteo quedó registrado.</div>
        <button
          type="button"
          onClick={props.onListo}
          className="mt-2.5 min-h-15 min-w-[220px] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
        >
          VOLVER AL INICIO
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4.5 px-7 py-7 text-center">
      <div className="flex h-26 w-26 items-center justify-center rounded-full bg-[#e6e9e2] text-[44px] font-bold text-texto-suave">
        ≠
      </div>
      <div className="max-w-[420px] text-[28px] font-extrabold">Los números no coinciden.</div>
      <div className="max-w-[420px] text-lg text-texto-suave">Podés volver a contar las veces que necesites.</div>
      {error && <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>}
      <div className="mt-2 flex w-full max-w-[380px] flex-col gap-3">
        <button
          type="button"
          onClick={props.onRecontar}
          className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
        >
          VOLVER A CONTAR
        </button>
        <button
          type="button"
          disabled={mutConfirmarIgual.isPending}
          onClick={() => {
            setError(null);
            mutConfirmarIgual.mutate();
          }}
          className="flex min-h-16 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-borde-fuerte bg-white text-texto hover:border-texto-suave disabled:opacity-50"
        >
          <span className="text-lg font-extrabold">CONFIRMAR IGUAL</span>
          <span className="text-[13px] font-semibold text-texto-suave">Se registrará tu conteo</span>
        </button>
      </div>
    </div>
  );
}
