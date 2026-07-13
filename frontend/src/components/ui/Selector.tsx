import { useMemo, useState } from 'react';

export interface ItemSelector {
  id: string | number;
  label: string;
  sub?: string;
}

interface Props {
  titulo: string;
  items: ItemSelector[];
  buscable?: boolean;
  onSeleccionar: (item: ItemSelector) => void;
  onCancelar: () => void;
}

// Réplica del overlay "picker" del diseño: bottom sheet con lista grande y
// buscador opcional.
export function Selector({ titulo, items, buscable = false, onSeleccionar, onCancelar }: Props) {
  const [busqueda, setBusqueda] = useState('');

  const filtrados = useMemo(() => {
    if (!buscable || !busqueda.trim()) return items;
    const q = busqueda.trim().toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, busqueda, buscable]);

  return (
    <div className="fixed inset-0 z-10 flex items-end bg-black/45">
      <div className="flex max-h-[82%] w-full flex-col overflow-hidden rounded-t-3xl bg-white">
        <div className="flex items-center gap-2.5 border-b border-borde px-4.5 py-4">
          <div className="flex-1 text-lg font-extrabold">{titulo}</div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCancelar}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-borde-fuerte bg-white text-lg"
          >
            ✕
          </button>
        </div>
        {buscable && (
          <div className="px-4.5 pt-3">
            <input
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="h-13 w-full rounded-xl border-2 border-borde-fuerte px-3.5 text-lg outline-primario"
            />
          </div>
        )}
        <div className="flex flex-col gap-2.5 overflow-auto px-4.5 py-3.5 pb-6">
          {filtrados.length === 0 && <div className="py-6 text-center text-texto-suave">Sin resultados.</div>}
          {filtrados.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSeleccionar(item)}
              className="flex min-h-[58px] w-full cursor-pointer flex-col gap-0.5 rounded-2xl border-2 border-borde bg-white px-4 py-3 text-left hover:border-primario"
            >
              <span className="text-lg font-bold text-texto">{item.label}</span>
              {item.sub && <span className="text-sm text-texto-suave">{item.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
