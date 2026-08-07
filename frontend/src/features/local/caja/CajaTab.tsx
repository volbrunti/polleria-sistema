import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { turnoActivo } from '../../../api/turnos';
import { usePosSocket, type FalloComandera } from '../../../lib/useSocket';
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

  // Comandas que no llegaron a imprimirse. El pedido igual se tomó: esto es
  // para que el cajero sepa que tiene que cantarla a viva voz.
  const [fallosComandera, setFallosComandera] = useState<FalloComandera[]>([]);

  // Push en vivo: el desbloqueo del admin (remoto o por clave) llega al
  // instante por la sala de la sucursal — sin esperar el polling.
  usePosSocket({
    onTurnoDesbloqueado: () => void turnoQ.refetch(),
    onFalloComandera: (fallo) => setFallosComandera((previos) => [...previos, fallo]),
  });

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
        conceptos={turno.conceptosConDiferencia}
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

      {fallosComandera.length > 0 && (
        <AvisoComanderaCaida
          fallos={fallosComandera}
          onCerrar={() => setFallosComandera([])}
        />
      )}

      {seccion === 'vender' && <POS sucursalId={sucursalId} />}
      {seccion === 'pedidos' && <PedidosActivos sucursalId={sucursalId} />}
      {seccion === 'caja' && <OperacionesCaja sucursalId={sucursalId} />}

      {cerrando && <CierreTurno sucursalId={sucursalId} onCancelar={() => setCerrando(false)} />}
    </div>
  );
}

const NOMBRE_DESTINO: Record<string, string> = {
  COCINA: 'cocina',
  MOSTRADOR: 'mostrador',
};

const NOMBRE_TICKET: Record<string, string> = {
  NUEVO: 'La comanda',
  ACTUALIZACION: 'La modificación',
  ANULACION: 'La anulación',
};

// Banner de comandera caída. No bloquea la caja ni pide confirmar nada: el
// pedido ya está tomado y el cajero tiene que poder seguir vendiendo. Dice
// QUÉ impresora falló y de qué pedido, que es lo único accionable — un "error
// de impresión" genérico lo dejaría sin saber qué compensar.
function AvisoComanderaCaida({
  fallos,
  onCerrar,
}: {
  fallos: FalloComandera[];
  onCerrar: () => void;
}) {
  return (
    <div className="border-b-2 border-error bg-error-suave px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-extrabold text-error-texto">
            {fallos.length === 1 ? 'No salió una comanda' : `No salieron ${fallos.length} comandas`}
          </div>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {fallos.map((f, i) => (
              <div key={`${f.ticketId}-${i}`} className="text-sm text-error-texto">
                {NOMBRE_TICKET[f.tipo] ?? 'El ticket'} del{' '}
                <strong>pedido #{f.pedidoId}</strong> no imprimió en{' '}
                <strong>
                  {f.destinos.map((d) => NOMBRE_DESTINO[d] ?? d.toLowerCase()).join(' ni ')}
                </strong>
                . Avisá a viva voz.
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-error-texto/80">
            El pedido se registró igual. Si sigue pasando, avisale al administrador para que revise
            la impresora.
          </div>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="min-h-11 shrink-0 cursor-pointer rounded-xl border border-error bg-white px-4 text-sm font-extrabold text-error-texto"
        >
          ENTENDIDO
        </button>
      </div>
    </div>
  );
}
