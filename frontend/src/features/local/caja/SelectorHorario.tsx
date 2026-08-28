// Horarios en pasos fijos (pedido del cliente: "13, 13:15, 13:30, 13:45", no
// horarios sueltos tipeados a mano). Cambiar el paso es tocar esta constante
// — nada más depende de ella.
export const PASO_HORARIO_MIN = 15;

// Solo las horas en que el local realmente atiende (§1.3): mediodía 10 a 15 y
// noche 19 a 23, cerrado los lunes. Antes se listaban las 96 franjas del día
// entero y el cajero tenía que scrollear por 40 botones muertos (00:00,
// 03:30…) para llegar a las útiles.
// Si alguna vez estiran el horario, se cambia acá y nada más depende de esto.
const TRAMOS = [
  { titulo: 'Mediodía', desde: '10:00', hasta: '15:00' },
  { titulo: 'Noche', desde: '19:00', hasta: '23:00' },
] as const;

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Extremos INCLUSIVOS: el último botón de cada tramo es la hora de cierre.
// Soporta pasar la medianoche ('24:00' se muestra como '00:00') por si alguna
// vez estiran el horario de la noche.
function generarTramo(desde: string, hasta: string, pasoMinutos: number): string[] {
  const horarios: string[] = [];
  for (let m = aMinutos(desde); m <= aMinutos(hasta); m += pasoMinutos) {
    const enElDia = m % (24 * 60);
    const hh = String(Math.floor(enElDia / 60)).padStart(2, '0');
    const mm = String(enElDia % 60).padStart(2, '0');
    horarios.push(`${hh}:${mm}`);
  }
  return horarios;
}

const HORARIOS_POR_TRAMO = TRAMOS.map((t) => ({
  titulo: t.titulo,
  horarios: generarTramo(t.desde, t.hasta, PASO_HORARIO_MIN),
}));

interface Props {
  valor: string;
  onElegir: (hora: string) => void;
  onQuitar: () => void;
  onCancelar: () => void;
}

// Mismo patrón visual que SelectorDescuento/SelectorRecargo (CobrarPedido.tsx):
// hoja con botones grandes, "SIN HORARIO" arriba si ya había uno elegido.
export function SelectorHorario({ valor, onElegir, onQuitar, onCancelar }: Props) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div className="flex max-h-[85vh] w-full flex-col gap-2.5 overflow-auto rounded-t-3xl bg-white p-5 sm:max-w-sm sm:rounded-3xl">
        <div className="text-xl font-extrabold">¿A qué hora lo retira?</div>

        {valor && (
          <button
            type="button"
            onClick={onQuitar}
            className="min-h-[48px] w-full cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
          >
            SIN HORARIO
          </button>
        )}

        {HORARIOS_POR_TRAMO.map((tramo) => (
          <div key={tramo.titulo} className="flex flex-col gap-2">
            <div className="text-xs font-extrabold tracking-wide text-texto-suave">
              {tramo.titulo.toUpperCase()}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {tramo.horarios.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onElegir(h)}
                  className={`min-h-[52px] cursor-pointer rounded-xl text-base font-bold ${
                    valor === h
                      ? 'bg-primario text-white'
                      : 'border-2 border-borde-fuerte bg-white text-texto hover:border-primario'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={onCancelar}
          className="mt-1 min-h-[52px] w-full cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
