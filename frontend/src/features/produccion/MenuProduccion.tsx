import { useQuery } from '@tanstack/react-query';
import { lineasDisponibles } from '../../api/ingresos';
import { fmtFecha, fmtNumero } from '../../lib/formato';
import type { LoteDeProduccion } from '../../api/types';

interface Props {
  loteAbierto: LoteDeProduccion | null | undefined;
  onIrIngreso: () => void;
  onIrProducir: () => void;
  onIrEnviar: () => void;
  onIrEnvios: () => void;
  onIrLote: (loteId: number) => void;
}

const A_MOSTRAR = 6;

export function MenuProduccion({ loteAbierto, onIrIngreso, onIrProducir, onIrEnviar, onIrEnvios, onIrLote }: Props) {
  // Pablo esperaba abrir la app y ver lo que entró: "cuando vas a producir, lo
  // primero que te tendría que salir son los 20 kilos de nalga". En vez de dar
  // vuelta el asistente, el menú muestra qué hay y de cuándo es.
  const disponible = useQuery({
    queryKey: ['ingresos', 'lineas-disponibles', 'todas'],
    queryFn: () => lineasDisponibles(),
  });
  const lineas = disponible.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-3.5 p-5">
      {loteAbierto && (
        <button
          type="button"
          onClick={() => onIrLote(loteAbierto.id)}
          className="flex w-full cursor-pointer flex-col gap-0.5 rounded-2xl border-2 border-[#d8a800] bg-[#fff7d9] px-4 py-3.5 text-left hover:bg-[#fdf0be]"
        >
          <span className="text-[13px] font-extrabold tracking-wide text-advertencia-texto">LOTE ABIERTO</span>
          <span className="text-[17px] font-bold text-texto">
            {loteAbierto.productoElaborado} — tocá para cargar el resultado
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onIrIngreso}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">LLEGÓ MERCADERÍA</span>
        <span className="text-[15px] text-texto-suave">Registrar un ingreso del proveedor</span>
      </button>

      <button
        type="button"
        onClick={onIrProducir}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">PRODUCIR</span>
        <span className="text-[15px] text-texto-suave">Empezar un lote de producción</span>
      </button>

      <button
        type="button"
        onClick={onIrEnviar}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">ENVIAR A LOCAL</span>
        <span className="text-[15px] text-texto-suave">Mandar mercadería a un local</span>
      </button>

      {lineas.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-white px-4 py-3.5">
          <div className="text-sm font-bold text-texto-suave">MATERIA PRIMA DISPONIBLE — lo último que entró</div>
          {lineas.slice(0, A_MOSTRAR).map((l) => (
            <div key={l.id} className="flex items-baseline justify-between gap-2.5 text-[15px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-bold">{l.producto?.nombre ?? 'Producto'}</span>
                <span className="text-texto-suave">
                  {' '}
                  · {l.ingresoMercaderia ? fmtFecha(l.ingresoMercaderia.fechaHora) : ''}
                </span>
              </span>
              <span className="shrink-0 font-extrabold">
                {fmtNumero(l.cantidadRestanteDisponible)}{' '}
                {l.producto?.unidadDeMedida === 'KG' ? 'kg' : 'u'}
              </span>
            </div>
          ))}
          {lineas.length > A_MOSTRAR && (
            <div className="text-sm text-texto-suave">y {lineas.length - A_MOSTRAR} partida(s) más…</div>
          )}
        </div>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={onIrEnvios}
        className="min-h-14 w-full cursor-pointer rounded-xl bg-transparent text-base font-semibold text-primario hover:bg-chip"
      >
        Ver mis envíos ›
      </button>
    </div>
  );
}
