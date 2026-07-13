interface Props {
  titulo: string;
  paso: number;
  totalPasos: number;
  onVolver: () => void;
}

// Header de wizard: back + "Paso X de N" + barra de progreso — siempre
// visible en qué paso está el operario (CLAUDE.md: flujos lineales tipo wizard).
export function EncabezadoWizard({ titulo, paso, totalPasos, onVolver }: Props) {
  const progreso = Math.round((paso / totalPasos) * 100);
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-3.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onVolver}
          aria-label="Volver"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-borde-fuerte bg-white text-xl"
        >
          ‹
        </button>
        <div className="flex-1 text-lg font-extrabold">{titulo}</div>
        <div className="rounded-lg bg-chip px-2.5 py-1.5 text-sm font-bold text-texto-suave">
          Paso {paso} de {totalPasos}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-borde">
        <div className="h-full rounded-full bg-primario transition-all" style={{ width: `${progreso}%` }} />
      </div>
    </div>
  );
}
