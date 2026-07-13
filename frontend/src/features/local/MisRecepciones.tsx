import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { listarTransferencias } from '../../api/transferencias';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';

interface Props {
  sucursalId: number;
  onVolver: () => void;
}

export function MisRecepciones({ sucursalId, onVolver }: Props) {
  const { usuario } = useAuth();
  const transferencias = useQuery({
    queryKey: ['transferencias', 'destino', sucursalId],
    queryFn: () => listarTransferencias({ sucursalDestinoId: sucursalId }),
  });

  const mias = (transferencias.data ?? []).filter(
    (t) => t.usuarioReceptor === usuario?.username && t.estado !== 'PENDIENTE_RECEPCION',
  );

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
        <div className="text-[22px] font-extrabold">Mis recepciones</div>
      </div>
      <div className="text-sm text-texto-suave">Se muestra solo lo que contaste vos.</div>

      {transferencias.isLoading && <div className="text-texto-suave">Cargando…</div>}
      {!transferencias.isLoading && mias.length === 0 && (
        <div className="text-texto-suave">Todavía no registraste ninguna recepción.</div>
      )}

      {mias.map((t) => (
        <div key={t.id} className="flex flex-col gap-1 rounded-2xl border border-borde bg-white px-4.5 py-4">
          <div className="flex justify-between gap-2.5">
            <span className="font-mono text-[13px] text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
            <span className="text-sm text-texto-suave">{fmtFechaHora(t.fechaHoraRecepcion ?? t.fechaHoraEnvio)}</span>
          </div>
          <div className="text-[17px] font-bold">
            {t.lineas.map((l) => `${l.producto} × ${fmtNumero(l.cantidadRecibida ?? '0', 0)}`).join(' · ')}
          </div>
          <div className="text-sm text-texto-suave">Estado: Registrado</div>
        </div>
      ))}
    </div>
  );
}
