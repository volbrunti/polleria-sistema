// Horarios en pasos fijos (pedido del cliente: "13, 13:15, 13:30, 13:45", no
// horarios sueltos tipeados a mano). Cambiar el paso es tocar esta constante
// — nada más depende de ella.
export const PASO_HORARIO_MIN = 15;

function generarHorarios(pasoMinutos: number): string[] {
  const horarios: string[] = [];
  for (let m = 0; m < 24 * 60; m += pasoMinutos) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    horarios.push(`${hh}:${mm}`);
  }
  return horarios;
}

const HORARIOS = generarHorarios(PASO_HORARIO_MIN);

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

        <div className="grid grid-cols-4 gap-2">
          {HORARIOS.map((h) => (
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
