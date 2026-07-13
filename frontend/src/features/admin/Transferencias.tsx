import { useQuery } from '@tanstack/react-query';
import { listarTransferencias } from '../../api/transferencias';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';

const ESTILO_ESTADO: Record<string, string> = {
  PENDIENTE_RECEPCION: '#7a5d00',
  CONFIRMADA: '#1a7f3f',
  CONFIRMADA_CON_DISCREPANCIA: '#a02514',
};

const LABEL_ESTADO: Record<string, string> = {
  PENDIENTE_RECEPCION: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  CONFIRMADA_CON_DISCREPANCIA: 'Con discrepancia',
};

export function Transferencias() {
  const transferencias = useQuery({ queryKey: ['transferencias'], queryFn: () => listarTransferencias() });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-2xl font-extrabold">Transferencias</h1>
        <div className="mt-1 text-sm text-texto-suave">Enviado vs. recibido, con ambas firmas.</div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid min-w-[1060px] grid-cols-[90px_110px_150px_1fr_90px_90px_80px_170px_130px] gap-x-3 bg-chip px-4.5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>REMITO</span>
          <span>FECHA</span>
          <span>RUTA</span>
          <span>PRODUCTO</span>
          <span className="text-right">ENVIADO</span>
          <span className="text-right">RECIBIDO</span>
          <span className="text-right">DIF.</span>
          <span>FIRMAS</span>
          <span>ESTADO</span>
        </div>
        {transferencias.isLoading && <div className="px-4.5 py-4 text-texto-suave">Cargando…</div>}
        {transferencias.data?.flatMap((t) =>
          t.lineas.map((l) => {
            const dif = l.diferencia != null ? Number(l.diferencia) : null;
            return (
              <div
                key={`${t.id}-${l.id}`}
                className="grid min-w-[1060px] grid-cols-[90px_110px_150px_1fr_90px_90px_80px_170px_130px] items-center gap-x-3 border-t border-[#eef1ea] px-4.5 py-3 text-sm"
              >
                <span className="font-mono text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
                <span className="text-texto-suave">{fmtFechaHora(t.fechaHoraEnvio)}</span>
                <span>
                  {t.sucursalOrigen} → {t.sucursalDestino}
                </span>
                <span className="font-semibold">{l.producto}</span>
                <span className="text-right">{l.cantidadEnviada != null ? fmtNumero(l.cantidadEnviada) : '—'}</span>
                <span className="text-right">{l.cantidadRecibida != null ? fmtNumero(l.cantidadRecibida) : '—'}</span>
                <span className="text-right font-extrabold" style={dif != null && dif !== 0 ? { color: '#a02514' } : undefined}>
                  {dif != null ? fmtNumero(dif) : '—'}
                </span>
                <span className="text-[13px] text-texto-suave">
                  {t.usuarioEmisor} → {t.usuarioReceptor ?? '—'}
                </span>
                <span className="text-[13px] font-extrabold" style={{ color: ESTILO_ESTADO[t.estado] }}>
                  {LABEL_ESTADO[t.estado]}
                </span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
