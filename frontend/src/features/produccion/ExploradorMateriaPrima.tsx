import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lineasDisponibles } from '../../api/ingresos';
import { productosProduciblesCon } from '../../api/produccion';
import { fmtFecha, fmtNumero } from '../../lib/formato';
import type { LineaIngresoDisponible, Producto } from '../../api/types';

interface GrupoMateriaPrima {
  productoId: number;
  nombre: string;
  unidadDeMedida: 'KG' | 'UNIDAD';
  total: number;
  /** Timestamp del ingreso más nuevo del grupo — 0 si ninguna partida tiene fecha. */
  ultimoIngreso: number;
  partidas: LineaIngresoDisponible[];
}

// Cuántas materias primas se muestran antes del "Ver más". El listado completo
// pasa de 20 insumos y en el celular eso es un scroll largo para llegar al
// resto del menú; lo que se busca casi siempre es lo que acaba de entrar.
const VISIBLES_AL_INICIO = 6;

function unidadTexto(unidad: 'KG' | 'UNIDAD'): string {
  return unidad === 'KG' ? 'kg' : 'u';
}

interface Props {
  /**
   * Si se pasa, tocar un producto "se puede producir con esto" dispara esto
   * (ej: precargarlo y saltar al paso 2 del asistente de producir). Sin
   * handler, el explorador es solo de consulta (uso desde el menú).
   */
  onElegirProducible?: (producto: Producto) => void;
  /** Título propio del bloque — se omite si ya vive dentro de un wizard con su título. */
  titulo?: string;
}

// Bidireccional: navegar materia prima → qué se puede producir con ella, en
// vez de arrancar siempre por "¿qué vas a producir?" (pedido de Pablo/Ariel
// tras la prueba en vivo). Reusa lineasDisponibles() (Flujo 1) agrupado por
// producto, y el endpoint nuevo GET /produccion/materia-prima/:id/producible
// (relación inversa de la ficha técnica) para el segundo salto.
export function ExploradorMateriaPrima({ onElegirProducible, titulo }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [elegida, setElegida] = useState<GrupoMateriaPrima | null>(null);
  const [verTodo, setVerTodo] = useState(false);

  const disponible = useQuery({
    queryKey: ['ingresos', 'lineas-disponibles', 'todas'],
    queryFn: () => lineasDisponibles(),
  });

  const producibles = useQuery({
    queryKey: ['produccion', 'producible-con', elegida?.productoId],
    queryFn: () => productosProduciblesCon(elegida!.productoId),
    enabled: elegida != null,
  });

  const agrupado = new Map<number, GrupoMateriaPrima>();
  for (const l of disponible.data ?? []) {
    if (!l.producto) continue;
    const actual = agrupado.get(l.productoId) ?? {
      productoId: l.productoId,
      nombre: l.producto.nombre,
      unidadDeMedida: l.producto.unidadDeMedida,
      total: 0,
      ultimoIngreso: 0,
      partidas: [],
    };
    actual.total += Number(l.cantidadRestanteDisponible);
    const entrada = l.ingresoMercaderia ? Date.parse(l.ingresoMercaderia.fechaHora) : 0;
    if (entrada > actual.ultimoIngreso) actual.ultimoIngreso = entrada;
    actual.partidas.push(l);
    agrupado.set(l.productoId, actual);
  }
  const buscando = busqueda.trim().length > 0;
  // Ordenado por lo último que entró, no alfabético: el operario abre esto
  // justo después de descargar al proveedor, y lo que va a producir es lo que
  // acaba de recibir. Sin fecha (partidas sintéticas de retorno) va al final.
  const lista = [...agrupado.values()]
    .filter((g) => (buscando ? g.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) : true))
    .sort((a, b) => b.ultimoIngreso - a.ultimoIngreso || a.nombre.localeCompare(b.nombre));

  // Buscando se muestran todas las coincidencias: recortar un resultado de
  // búsqueda a 6 esconde justo lo que el operario fue a buscar.
  const visibles = buscando || verTodo ? lista : lista.slice(0, VISIBLES_AL_INICIO);
  const ocultas = lista.length - visibles.length;

  if (elegida) {
    return (
      <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
        <button
          type="button"
          onClick={() => setElegida(null)}
          className="w-fit cursor-pointer text-sm font-bold text-primario"
        >
          ‹ Volver a materia prima
        </button>
        <div className="text-xl font-extrabold">{elegida.nombre}</div>
        <div className="text-sm font-bold text-texto-suave">
          {fmtNumero(elegida.total)} {unidadTexto(elegida.unidadDeMedida)} en {elegida.partidas.length} partida
          {elegida.partidas.length === 1 ? '' : 's'}
        </div>
        <div className="flex flex-col gap-1.5">
          {elegida.partidas.map((p) => (
            <div key={p.id} className="flex items-baseline justify-between gap-2.5 rounded-xl border border-borde bg-white px-3.5 py-2.5 text-[15px]">
              <span className="min-w-0 flex-1 truncate text-texto-suave">
                {p.ingresoMercaderia ? fmtFecha(p.ingresoMercaderia.fechaHora) : 'sin fecha'}
                {p.ingresoMercaderia ? ` — ${p.ingresoMercaderia.proveedor.nombre}` : ''}
              </span>
              <span className="shrink-0 font-extrabold">
                {fmtNumero(p.cantidadRestanteDisponible)} {unidadTexto(elegida.unidadDeMedida)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 text-sm font-bold text-texto-suave">SE PUEDE PRODUCIR CON ESTO</div>
        {producibles.isLoading && <div className="text-sm text-texto-suave">Buscando…</div>}
        {producibles.data?.length === 0 && (
          <div className="text-sm text-texto-suave">
            Ninguna receta activa usa este insumo todavía.
          </div>
        )}
        {producibles.data?.map((p) =>
          onElegirProducible ? (
            <button
              key={p.id}
              type="button"
              onClick={() => onElegirProducible(p)}
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-primario bg-primario-suave px-4.5 py-3 text-left hover:bg-chip"
            >
              <span className="text-[17px] font-bold text-primario">{p.nombre}</span>
              <span className="shrink-0 text-sm font-bold text-primario">PRODUCIR ▸</span>
            </button>
          ) : (
            <div key={p.id} className="min-h-14 w-full rounded-2xl border border-borde bg-white px-4.5 py-3 text-[17px] font-bold">
              {p.nombre}
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {titulo && <div className="text-sm font-bold text-texto-suave">{titulo}</div>}
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar materia prima…"
        className="h-11 w-full rounded-[10px] border border-borde-fuerte px-3 text-sm"
      />
      {disponible.isLoading && <div className="text-sm text-texto-suave">Cargando…</div>}
      <div className="flex flex-col gap-1.5">
        {visibles.map((g) => (
          <button
            key={g.productoId}
            type="button"
            onClick={() => setElegida(g)}
            className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-borde bg-white px-3.5 py-2.5 text-left hover:border-primario"
          >
            <span className="min-w-0 flex-1">
              {/* Sin truncate: la fila ya es de dos renglones, y cortar
                  "Discos de empanada grandes…" con puntos suspensivos obliga
                  a abrir el producto para saber cuál es. */}
              <span className="block break-words text-[15px] font-bold">{g.nombre}</span>
              {g.ultimoIngreso > 0 && (
                <span className="block text-[13px] text-texto-suave">
                  Entró el {fmtFecha(new Date(g.ultimoIngreso).toISOString())}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[15px] font-extrabold">
              {fmtNumero(g.total)} {unidadTexto(g.unidadDeMedida)}
            </span>
          </button>
        ))}
        {lista.length === 0 && !disponible.isLoading && (
          <div className="py-4 text-center text-sm text-texto-suave">Sin resultados.</div>
        )}
      </div>

      {!buscando && (ocultas > 0 || verTodo) && (
        <button
          type="button"
          onClick={() => setVerTodo((v) => !v)}
          className="min-h-12 w-full cursor-pointer rounded-xl border border-borde-fuerte bg-white text-sm font-bold text-texto-suave hover:border-primario"
        >
          {verTodo ? 'VER MENOS' : `VER MÁS (${ocultas})`}
        </button>
      )}
    </div>
  );
}
