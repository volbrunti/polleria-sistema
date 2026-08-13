import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { turnoActivo } from '../../../api/turnos';
import { usePosSocket, type FalloComandera } from '../../../lib/useSocket';
import { reimprimirTicket } from '../../../api/comanderas';
import { ApiError } from '../../../api/client';
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
      {/* Los cuatro botones no entran en 375 px: "Cerrar turno" quedaba cortado
          15 px contra el borde derecho, sin ningún contenedor que scrollee
          (auditoría 2026-08-07, V-1). Con padding más chico y texto reducido en
          móvil entra completo; de `sm` para arriba queda igual que antes. */}
      <div className="flex items-center gap-1.5 border-b border-borde bg-white px-2 py-2 sm:px-3">
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
            className={`min-h-12 shrink-0 cursor-pointer rounded-xl px-3 text-[15px] font-bold sm:px-4.5 sm:text-base ${
              seccion === s ? 'bg-primario text-white' : 'text-texto-suave hover:bg-chip'
            }`}
          >
            {etiqueta}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCerrando(true)}
          className="ml-auto min-h-12 shrink-0 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-3 text-[13px] font-bold text-texto-suave hover:text-texto sm:px-4.5 sm:text-[15px]"
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
          <div className="mt-0.5 flex flex-col gap-1.5">
            {fallos.map((f, i) => (
              <div key={`${f.ticketId}-${i}`} className="text-sm text-error-texto">
                {NOMBRE_TICKET[f.tipo] ?? 'El ticket'} del{' '}
                <strong>pedido #{f.pedidoId}</strong> no imprimió en{' '}
                <strong>
                  {f.destinos.map((d) => NOMBRE_DESTINO[d] ?? d.toLowerCase()).join(' ni ')}
                </strong>
                . Avisá a viva voz.
                {/* Si la impresora se destrabó, esto la vuelve a intentar en el
                    momento. Antes el cajero no tenía nada más que hacer que
                    cantar la comanda (auditoría 2026-08-07, E-5). */}
                <BotonReimprimir ticketId={f.ticketId} />
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

// Reintento de impresión desde el mostrador. Muestra el resultado por
// comandera en vez de un "listo" genérico: si vuelve a fallar la de cocina
// pero sale la de mostrador, el cajero necesita saber exactamente eso.
function BotonReimprimir({ ticketId }: { ticketId: number }) {
  const [estado, setEstado] = useState<'idle' | 'enviando' | string>('idle');

  async function reintentar() {
    setEstado('enviando');
    try {
      const r = await reimprimirTicket(ticketId);
      const fallaron = r.resultados.filter((x) => !x.impreso);
      setEstado(
        fallaron.length === 0
          ? '✓ Salió'
          : `Sigue sin salir en ${fallaron
              .map((x) => NOMBRE_DESTINO[x.destino] ?? x.destino.toLowerCase())
              .join(' ni ')}`,
      );
    } catch (e) {
      setEstado(e instanceof ApiError ? e.message : 'No se pudo reintentar.');
    }
  }

  return (
    <span className="ml-1 inline-flex items-center gap-2">
      <button
        type="button"
        disabled={estado === 'enviando'}
        onClick={() => void reintentar()}
        className="min-h-9 cursor-pointer rounded-lg border border-error bg-white px-2.5 text-xs font-extrabold text-error-texto disabled:opacity-50"
      >
        {estado === 'enviando' ? 'IMPRIMIENDO…' : 'REIMPRIMIR'}
      </button>
      {estado !== 'idle' && estado !== 'enviando' && (
        <span className="text-xs font-bold text-error-texto">{estado}</span>
      )}
    </span>
  );
}
