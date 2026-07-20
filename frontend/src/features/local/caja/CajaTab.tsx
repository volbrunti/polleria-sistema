import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { turnoActivo } from '../../../api/turnos';
import { usePosSocket } from '../../../lib/useSocket';
import { AperturaTurno } from './AperturaTurno';
import { PantallaBloqueada } from './PantallaBloqueada';
import { POS } from './POS';
import { PedidosActivos } from './PedidosActivos';
import { OperacionesCaja } from './OperacionesCaja';
import { CierreTurno } from './CierreTurno';

interface Props {
  sucursalId: number;
}

type Seccion = 'vender' | 'pedidos' | 'caja';

// Gate de turno (§5.1): sin turno abierto no hay POS. El estado del turno
// decide qué se ve: apertura ciega / pantalla de bloqueo / POS operativo.
export function CajaTab({ sucursalId }: Props) {
  const [seccion, setSeccion] = useState<Seccion>('vender');
  const [cerrando, setCerrando] = useState(false);

  const turnoQ = useQuery({
    queryKey: ['turno-activo', sucursalId],
    queryFn: () => turnoActivo(sucursalId),
    // Respaldo del socket: si el push falla, el desbloqueo igual llega solo
    refetchInterval: 20_000,
  });

  // Push en vivo: el desbloqueo del admin (remoto o por clave) llega al
  // instante por la sala de la sucursal — sin esperar el polling.
  usePosSocket({ onTurnoDesbloqueado: () => void turnoQ.refetch() });

  if (turnoQ.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-texto-suave">Cargando…</div>;
  }

  const turno = turnoQ.data?.turno ?? null;

  if (!turno || turno.estado === 'CERRADO') {
    return <AperturaTurno sucursalId={sucursalId} onResuelto={() => void turnoQ.refetch()} />;
  }

  if (turno.estado === 'BLOQUEADO') {
    return (
      <PantallaBloqueada
        turnoId={turno.id}
        onReintentar={() => void turnoQ.refetch()}
        onDesbloqueado={() => void turnoQ.refetch()}
      />
    );
  }

  // ── Turno ABIERTO: POS con subnavegación ──
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-borde bg-white px-3 py-2">
        {(
          [
            ['vender', 'Vender'],
            ['pedidos', 'Pedidos'],
            ['caja', 'Caja'],
          ] as const
        ).map(([s, etiqueta]) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeccion(s)}
            className={`min-h-12 cursor-pointer rounded-xl px-4.5 text-base font-bold ${
              seccion === s ? 'bg-primario text-white' : 'text-texto-suave hover:bg-chip'
            }`}
          >
            {etiqueta}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCerrando(true)}
          className="ml-auto min-h-12 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-4.5 text-[15px] font-bold text-texto-suave hover:text-texto"
        >
          Cerrar turno
        </button>
      </div>

      {seccion === 'vender' && <POS sucursalId={sucursalId} />}
      {seccion === 'pedidos' && <PedidosActivos sucursalId={sucursalId} />}
      {seccion === 'caja' && <OperacionesCaja sucursalId={sucursalId} />}

      {cerrando && <CierreTurno sucursalId={sucursalId} onCancelar={() => setCerrando(false)} />}
    </div>
  );
}
