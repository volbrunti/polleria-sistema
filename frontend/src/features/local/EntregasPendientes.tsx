import { useQuery } from '@tanstack/react-query';
import { listarTransferencias } from '../../api/transferencias';
import { fmtFechaHora } from '../../lib/formato';
import type { Transferencia } from '../../api/types';

interface Props {
  sucursalId: number;
  onAbrir: (t: Transferencia) => void;
  onIrHistorial: () => void;
}

export function EntregasPendientes({ sucursalId, onAbrir, onIrHistorial }: Props) {
  const pendientes = useQuery({
    queryKey: ['transferencias', 'pendientes', sucursalId],
    queryFn: () => listarTransferencias({ estado: 'PENDIENTE_RECEPCION', sucursalDestinoId: sucursalId }),
    refetchInterval: 15000,
  });

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold">Entregas pendientes</div>
          <div className="text-[15px] text-texto-suave">
            Cuando llegue el reparto, tocá la entrega y contá lo que llegó.
          </div>
        </div>
        <button
          type="button"
          onClick={onIrHistorial}
          className="min-h-12 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-[15px] font-semibold text-primario"
        >
          Mis recepciones ›
        </button>
      </div>

      {pendientes.isLoading && <div className="text-texto-suave">Cargando…</div>}

      {pendientes.data && pendientes.data.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="flex h-21 w-21 items-center justify-center rounded-full bg-chip text-[34px] text-borde-fuerte">
            ✓
          </div>
          <div className="text-lg font-bold text-texto-suave">No hay entregas pendientes por ahora.</div>
        </div>
      )}

      {pendientes.data?.map((t) => (
        <div key={t.id} className="flex items-center gap-4.5 rounded-2xl border border-borde bg-white px-5 py-4.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
              <span className="text-[15px] font-bold">{fmtFechaHora(t.fechaHoraEnvio)}</span>
              <span className="text-sm text-texto-suave">desde {t.sucursalOrigen}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.lineas.map((l) => (
                <span key={l.id} className="rounded-md bg-chip px-3.5 py-2 text-base font-bold">
                  {l.producto}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAbrir(t)}
            className="min-h-14 cursor-pointer rounded-2xl bg-primario px-6 text-lg font-extrabold text-white hover:bg-primario-hover"
          >
            CONTAR ›
          </button>
        </div>
      ))}
    </div>
  );
}
