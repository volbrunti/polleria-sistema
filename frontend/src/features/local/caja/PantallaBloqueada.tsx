import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { usarClaveEmergencia } from '../../../api/turnos';

interface Props {
  turnoId: number;
  onReintentar: () => void; // refetch: si el admin desbloqueó remoto, pasa a ABIERTO
  onDesbloqueado: () => void;
}

// Pantalla de bloqueo (CLAUDE-MODULO-2.md §5.1): mensaje genérico SIN números,
// sin decir cuál de los dos arqueos falló ni de qué lado está el error.
// La opción de clave de emergencia es discreta (chica, en un rincón).
export function PantallaBloqueada({ turnoId, onReintentar, onDesbloqueado }: Props) {
  const [mostrarClave, setMostrarClave] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutClave = useMutation({
    mutationFn: () => usarClaveEmergencia({ codigo: codigo.trim().toUpperCase(), turnoId }),
    onSuccess: () => onDesbloqueado(),
    // Error SIEMPRE genérico (el backend tampoco distingue expirada/usada/inexistente)
    onError: () => setError('La clave no es válida.'),
  });

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-chip text-5xl">🔒</div>
      <div className="max-w-[440px]">
        <div className="text-[24px] font-extrabold">Hay una diferencia en el conteo</div>
        <div className="mt-2 text-lg text-texto-suave">
          Se notificó al administrador. Esperá la autorización para continuar.
        </div>
      </div>

      <button
        type="button"
        onClick={onReintentar}
        className="min-h-[56px] cursor-pointer rounded-2xl border-2 border-primario bg-white px-8 text-lg font-extrabold text-primario hover:bg-chip"
      >
        VOLVER A INTENTAR
      </button>

      {mostrarClave && (
        <div className="flex w-full max-w-[360px] flex-col gap-2.5">
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Clave de emergencia"
            autoCapitalize="characters"
            autoComplete="off"
            className="min-h-[56px] rounded-2xl border-2 border-borde-fuerte bg-white px-4 text-center text-xl font-extrabold uppercase tracking-[0.2em]"
          />
          {error && (
            <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{error}</div>
          )}
          <button
            type="button"
            disabled={codigo.trim().length < 4 || mutClave.isPending}
            onClick={() => {
              setError(null);
              mutClave.mutate();
            }}
            className="min-h-[56px] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutClave.isPending ? 'VERIFICANDO…' : 'DESBLOQUEAR'}
          </button>
        </div>
      )}

      {/* Opción discreta — abajo a la derecha, tipografía chica */}
      {!mostrarClave && (
        <button
          type="button"
          onClick={() => setMostrarClave(true)}
          className="absolute bottom-4 right-5 cursor-pointer text-[13px] text-texto-suave underline-offset-2 hover:underline"
        >
          Tengo una clave
        </button>
      )}
    </div>
  );
}
