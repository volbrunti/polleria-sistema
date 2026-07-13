import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { listarTransferencias } from '../../api/transferencias';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';

const ESTADO_ESTILO: Record<string, { texto: string; color: string; bg: string }> = {
  PENDIENTE_RECEPCION: { texto: 'Pendiente', color: '#7a5d00', bg: '#fff7d9' },
  CONFIRMADA: { texto: 'Confirmado', color: '#1a7f3f', bg: '#e3f2e7' },
  CONFIRMADA_CON_DISCREPANCIA: { texto: 'Con discrepancia', color: '#a02514', bg: '#faeae7' },
};

interface Props {
  onVolver: () => void;
}

export function MisEnvios({ onVolver }: Props) {
  const { usuario } = useAuth();
  const transferencias = useQuery({ queryKey: ['transferencias'], queryFn: () => listarTransferencias() });

  const mias = transferencias.data?.filter((t) => t.usuarioEmisor === usuario?.username) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onVolver}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-borde-fuerte bg-white text-xl"
        >
          ‹
        </button>
        <div className="text-xl font-extrabold">Mis envíos</div>
      </div>

      {transferencias.isLoading && <div className="text-texto-suave">Cargando…</div>}
      {!transferencias.isLoading && mias.length === 0 && <div className="text-texto-suave">Todavía no enviaste nada.</div>}

      {mias.map((t) => {
        const estilo = ESTADO_ESTILO[t.estado];
        return (
          <div key={t.id} className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-2.5">
              <span className="font-mono text-[13px] text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
              <span
                className="rounded-lg px-2.5 py-1 text-[13px] font-extrabold"
                style={{ color: estilo.color, background: estilo.bg }}
              >
                {estilo.texto}
              </span>
            </div>
            <div className="text-[17px] font-bold">
              {t.sucursalDestino} · {fmtFechaHora(t.fechaHoraEnvio)}
            </div>
            <div className="text-[15px] text-texto-suave">
              {t.lineas
                .map((l) => `${l.producto} × ${fmtNumero(l.cantidadEnviada ?? '0', 0)}`)
                .join(' · ')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
