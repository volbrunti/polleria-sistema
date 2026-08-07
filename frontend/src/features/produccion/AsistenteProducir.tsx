import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EncabezadoWizard } from '../../components/ui/EncabezadoWizard';
import { Selector } from '../../components/ui/Selector';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { listarProductos } from '../../api/productos';
import { lineasDisponibles } from '../../api/ingresos';
import { abrirLote, listarProductosProducibles, insumosEsperados } from '../../api/produccion';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtNumero } from '../../lib/formato';
import type { LineaIngresoDisponible, Producto } from '../../api/types';

interface Props {
  onVolver: () => void;
  onLoteAbierto: (loteId: number) => void;
}

interface InsumoUI {
  producto: Producto;
  linea: LineaIngresoDisponible;
  cantidadUsada: number;
}

interface EntradaReparto {
  linea: LineaIngresoDisponible;
  cantidad: number;
}

type Overlay =
  // Agregar un insumo a mano (fuera de la ficha): buscar → partida → cantidad
  | { tipo: 'selectorInsumoManual' }
  | { tipo: 'cargandoPartidas'; producto: Producto; modo: 'manual' }
  | { tipo: 'selectorPartidaManual'; producto: Producto; lineas: LineaIngresoDisponible[] }
  | { tipo: 'tecladoCantidadManual'; producto: Producto; linea: LineaIngresoDisponible }
  // Insumo precargado de la ficha: total deseado → reparto automático → revisar/ajustar
  | { tipo: 'cargandoPartidasFicha'; producto: Producto }
  | { tipo: 'tecladoTotalFicha'; producto: Producto; lineas: LineaIngresoDisponible[]; totalDisponible: number }
  | {
      tipo: 'revisarReparto';
      producto: Producto;
      deseado: number;
      todasLasLineas: LineaIngresoDisponible[];
      entradas: EntradaReparto[];
    }
  | {
      tipo: 'tecladoEditarEntrada';
      producto: Producto;
      deseado: number;
      todasLasLineas: LineaIngresoDisponible[];
      entradas: EntradaReparto[];
      indice: number;
    }
  // Editar cantidad de un insumo ya cargado en la lista final
  | { tipo: 'tecladoEditarCargado'; indice: number }
  | null;

function redondear3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function unidadTexto(unidad: 'KG' | 'UNIDAD', cantidad: number | string): string {
  if (unidad === 'KG') return 'kg';
  return Number(cantidad) === 1 ? 'unidad' : 'unidades';
}

// Reparto FIFO: toma de la partida más vieja a la más nueva hasta cubrir el
// total deseado. `lineas` ya viene ordenada así por el backend.
function calcularReparto(deseado: number, lineas: LineaIngresoDisponible[]): EntradaReparto[] {
  let restante = deseado;
  const entradas: EntradaReparto[] = [];
  for (const linea of lineas) {
    if (restante <= 0) break;
    const disponible = Number(linea.cantidadRestanteDisponible);
    const tomar = Math.min(disponible, restante);
    if (tomar > 0) {
      entradas.push({ linea, cantidad: redondear3(tomar) });
      restante -= tomar;
    }
  }
  return entradas;
}

// Al editar o borrar una entrada del reparto: si la suma queda por debajo de
// lo deseado, completa automático — primero ampliando entradas que ya están
// en el reparto y todavía tienen margen en su propia partida (ej: bajaste
// una partida de 5 a 2, la otra partida tenía 8 disponibles pero solo 5
// asignados: sube a 8 antes de sumar una partida nueva), y recién si no
// alcanza, agrega partidas nuevas que todavía no se usaron (FIFO).
function reajustarReparto(
  entradas: EntradaReparto[],
  deseado: number,
  todasLasLineas: LineaIngresoDisponible[],
  // Índice que se acaba de editar a mano — se excluye de "ampliar entradas
  // existentes" para no deshacer el ajuste manual que el usuario recién hizo.
  indiceExcluido?: number,
): EntradaReparto[] {
  const nuevas = entradas.map((e) => ({ ...e }));
  const suma = () => nuevas.reduce((acc, e) => acc + e.cantidad, 0);
  let falta = deseado - suma();
  if (falta <= 0) return nuevas;

  for (let idx = 0; idx < nuevas.length; idx++) {
    if (falta <= 0) break;
    if (idx === indiceExcluido) continue;
    const entrada = nuevas[idx]!;
    const disponible = Number(entrada.linea.cantidadRestanteDisponible);
    const margen = disponible - entrada.cantidad;
    if (margen > 0) {
      const tomar = Math.min(margen, falta);
      entrada.cantidad = redondear3(entrada.cantidad + tomar);
      falta -= tomar;
    }
  }

  if (falta > 0) {
    const usadas = new Set(nuevas.map((e) => e.linea.id));
    const disponibles = todasLasLineas.filter((l) => !usadas.has(l.id) && Number(l.cantidadRestanteDisponible) > 0);
    for (const linea of disponibles) {
      if (falta <= 0) break;
      const disponible = Number(linea.cantidadRestanteDisponible);
      const tomar = Math.min(disponible, falta);
      if (tomar > 0) {
        nuevas.push({ linea, cantidad: redondear3(tomar) });
        falta -= tomar;
      }
    }
  }
  return nuevas;
}

export function AsistenteProducir({ onVolver, onLoteAbierto }: Props) {
  const [paso, setPaso] = useState(1);
  const [productoElaborado, setProductoElaborado] = useState<Producto | null>(null);
  const [insumos, setInsumos] = useState<InsumoUI[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const productosProducibles = useQuery({
    queryKey: ['produccion', 'productos-producibles'],
    queryFn: listarProductosProducibles,
  });
  const materiasPrimas = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA', activo: true }),
  });
  const insumosDeFicha = useQuery({
    queryKey: ['produccion', 'insumos-esperados', productoElaborado?.id],
    queryFn: () => insumosEsperados(productoElaborado!.id),
    enabled: productoElaborado != null,
  });

  const mutAbrir = useMutation({
    mutationFn: abrirLote,
    onSuccess: (lote) => onLoteAbierto(lote.id),
    onError: (err) => setErrorEnvio(err instanceof ApiError ? err.message : 'No se pudo iniciar el lote.'),
  });

  function volver() {
    if (paso === 1) return onVolver();
    setPaso((p) => p - 1);
  }

  function productoDe(productoInsumoId: number, nombreFallback: string, unidadFallback: 'KG' | 'UNIDAD'): Producto {
    return (
      materiasPrimas.data?.find((p) => p.id === productoInsumoId) ?? {
        id: productoInsumoId,
        nombre: nombreFallback,
        categoria: '',
        categoriaMadre: null,
        tipo: 'MATERIA_PRIMA',
        unidadDeMedida: unidadFallback,
        activo: true,
      }
    );
  }

  // Insumos de la ficha que todavía no tienen NINGUNA partida cargada en la lista final
  const insumosPendientes = (insumosDeFicha.data ?? []).filter(
    (ie) => !insumos.some((i) => i.producto.id === ie.productoInsumoId),
  );

  async function elegirInsumoManual(producto: Producto) {
    setOverlay({ tipo: 'cargandoPartidas', producto, modo: 'manual' });
    try {
      const lineas = await lineasDisponibles(producto.id);
      const yaUsadas = new Set(insumos.map((i) => i.linea.id));
      const disponibles = lineas.filter((l) => !yaUsadas.has(l.id) && Number(l.cantidadRestanteDisponible) > 0);
      setOverlay({ tipo: 'selectorPartidaManual', producto, lineas: disponibles });
    } catch {
      setOverlay(null);
    }
  }

  async function cargarInsumoDeFicha(ie: { productoInsumoId: number; nombre: string; unidadDeMedida: 'KG' | 'UNIDAD' }) {
    const producto = productoDe(ie.productoInsumoId, ie.nombre, ie.unidadDeMedida);
    setOverlay({ tipo: 'cargandoPartidasFicha', producto });
    try {
      const lineas = await lineasDisponibles(producto.id);
      const yaUsadas = new Set(insumos.map((i) => i.linea.id));
      const disponibles = lineas.filter((l) => !yaUsadas.has(l.id) && Number(l.cantidadRestanteDisponible) > 0);
      const totalDisponible = disponibles.reduce((acc, l) => acc + Number(l.cantidadRestanteDisponible), 0);
      setOverlay({ tipo: 'tecladoTotalFicha', producto, lineas: disponibles, totalDisponible });
    } catch {
      setOverlay(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <EncabezadoWizard titulo="Producir" paso={paso} totalPasos={3} onVolver={volver} />

      {paso === 1 && (
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">¿Qué vas a producir?</div>
          {productosProducibles.isLoading && <div className="text-texto-suave">Cargando…</div>}
          {productosProducibles.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProductoElaborado(p);
                setInsumos([]);
                setPaso(2);
              }}
              className="min-h-18 w-full cursor-pointer rounded-2xl border-2 border-borde bg-white px-4.5 py-4 text-left text-xl font-extrabold hover:border-primario"
            >
              {p.nombre}
            </button>
          ))}
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Insumos que usaste</div>
          <div className="text-[15px] text-texto-suave">
            Decí cuánto usaste en total de cada insumo — el sistema reparte solo entre las partidas disponibles.
          </div>

          {insumos.map((i, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-bold">{i.producto.nombre}</div>
                <div className="text-sm text-texto-suave">
                  Partida del {fmtFecha(i.linea.ingresoMercaderia?.fechaHora ?? '')} · usaste{' '}
                  {fmtNumero(i.cantidadUsada)} {unidadTexto(i.producto.unidadDeMedida, i.cantidadUsada)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Editar"
                onClick={() => setOverlay({ tipo: 'tecladoEditarCargado', indice: idx })}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-borde-fuerte bg-white text-lg hover:bg-chip"
              >
                ✎
              </button>
              <button
                type="button"
                aria-label="Borrar"
                onClick={() => setInsumos((is) => is.filter((_, j) => j !== idx))}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-red-200 bg-white text-lg font-bold text-error hover:bg-error-suave"
              >
                ✕
              </button>
            </div>
          ))}

          {insumosPendientes.length > 0 && (
            <>
              <div className="mt-1.5 text-sm font-bold text-texto-suave">Pide la receta (todavía sin cargar)</div>
              {insumosPendientes.map((ie) => (
                <button
                  key={ie.productoInsumoId}
                  type="button"
                  onClick={() => void cargarInsumoDeFicha(ie)}
                  className="flex min-h-[58px] w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-primario bg-primario-suave px-4.5 py-3 text-left hover:bg-chip"
                >
                  <span className="text-[17px] font-bold text-primario">
                    {ie.nombre}
                    {ie.esPrincipal ? ' (principal)' : ''}
                  </span>
                  <span className="text-sm font-bold text-primario">CARGAR ▸</span>
                </button>
              ))}
            </>
          )}

          <button
            type="button"
            onClick={() => setOverlay({ tipo: 'selectorInsumoManual' })}
            className="min-h-[62px] w-full cursor-pointer rounded-2xl border-2 border-dashed border-borde-fuerte bg-transparent text-lg font-bold text-primario hover:bg-chip"
          >
            ＋ AGREGAR OTRO INSUMO
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={insumos.length === 0}
            onClick={() => setPaso(3)}
            className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white disabled:opacity-50"
          >
            CONTINUAR
          </button>
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Revisá antes de empezar</div>
          <div className="rounded-2xl border border-borde bg-white p-4">
            <div className="text-[15px] text-texto-suave">Vas a producir</div>
            <div className="text-xl font-extrabold">{productoElaborado?.nombre}</div>
          </div>
          {insumos.map((i, idx) => (
            <div key={idx} className="rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="text-[17px] font-bold">{i.producto.nombre}</div>
              <div className="text-sm text-texto-suave">
                Partida #{i.linea.id} · usaste {fmtNumero(i.cantidadUsada)} {unidadTexto(i.producto.unidadDeMedida, i.cantidadUsada)}
              </div>
            </div>
          ))}
          {errorEnvio && (
            <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">
              {errorEnvio}
            </div>
          )}
          <div className="flex-1" />
          <button
            type="button"
            disabled={mutAbrir.isPending}
            onClick={() => {
              setErrorEnvio(null);
              mutAbrir.mutate({
                productoElaboradoId: productoElaborado!.id,
                insumos: insumos.map((i) => ({
                  productoInsumoId: i.producto.id,
                  lineaIngresoOrigenId: i.linea.id,
                  cantidadUsada: i.cantidadUsada,
                })),
              });
            }}
            className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutAbrir.isPending ? 'INICIANDO…' : 'EMPEZAR PRODUCCIÓN'}
          </button>
        </div>
      )}

      {/* ── Agregar insumo a mano (fuera de la ficha) ── */}
      {overlay?.tipo === 'selectorInsumoManual' && (
        <Selector
          titulo="Elegí el insumo"
          buscable
          items={(materiasPrimas.data ?? []).map((p) => ({ id: p.id, label: p.nombre }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const producto = materiasPrimas.data!.find((p) => p.id === item.id)!;
            void elegirInsumoManual(producto);
          }}
        />
      )}

      {(overlay?.tipo === 'cargandoPartidas' || overlay?.tipo === 'cargandoPartidasFicha') && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/45">
          <div className="w-full rounded-t-3xl bg-white p-6 text-center text-texto-suave">Buscando partidas…</div>
        </div>
      )}

      {overlay?.tipo === 'selectorPartidaManual' && (
        <Selector
          titulo={`Elegí la partida — ${overlay.producto.nombre}`}
          items={overlay.lineas.map((l) => ({
            id: l.id,
            label: `${fmtNumero(l.cantidadRealPesada)} ${l.producto ? unidadTexto(l.producto.unidadDeMedida, l.cantidadRealPesada) : ''} — llegó el ${
              l.ingresoMercaderia ? fmtFecha(l.ingresoMercaderia.fechaHora) : '?'
            } — ${l.ingresoMercaderia?.proveedor.nombre ?? ''}`,
            sub: `Quedan ${fmtNumero(l.cantidadRestanteDisponible)} ${l.producto ? unidadTexto(l.producto.unidadDeMedida, l.cantidadRestanteDisponible) : ''}`,
          }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const linea = overlay.lineas.find((l) => l.id === item.id)!;
            setOverlay({ tipo: 'tecladoCantidadManual', producto: overlay.producto, linea });
          }}
        />
      )}

      {overlay?.tipo === 'tecladoCantidadManual' && (
        <TecladoNumerico
          titulo="¿Cuánto usaste?"
          subtitulo={overlay.producto.nombre}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          maximo={Number(overlay.linea.cantidadRestanteDisponible)}
          pistaDisponible={`Quedan ${fmtNumero(overlay.linea.cantidadRestanteDisponible)} ${unidadTexto(overlay.producto.unidadDeMedida, overlay.linea.cantidadRestanteDisponible)} en esta partida.`}
          mensajeMaximo={`No alcanza. En esa partida quedan ${fmtNumero(overlay.linea.cantidadRestanteDisponible)} ${unidadTexto(overlay.producto.unidadDeMedida, overlay.linea.cantidadRestanteDisponible)}.`}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            setInsumos((is) => [...is, { producto: overlay.producto, linea: overlay.linea, cantidadUsada: cantidad }]);
            setOverlay(null);
          }}
        />
      )}

      {/* ── Insumo precargado de la ficha: total → reparto automático ── */}
      {overlay?.tipo === 'tecladoTotalFicha' && (
        <TecladoNumerico
          titulo={`¿Cuánto vas a usar de ${overlay.producto.nombre} en total?`}
          subtitulo="Elegí el total — el sistema reparte solo entre las partidas, de la más vieja a la más nueva."
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          maximo={overlay.totalDisponible}
          // Desglosado por partida, no solo el total: el saldo chico de una
          // partida vieja se pierde adentro de la suma y termina olvidado en
          // la heladera (pedido de Ariel y Pablo, reunión 4/8).
          pistaDisponible={
            <div className="flex flex-col gap-1">
              <div>
                Tenés {fmtNumero(overlay.totalDisponible)}{' '}
                {unidadTexto(overlay.producto.unidadDeMedida, overlay.totalDisponible)} entre{' '}
                {overlay.lineas.length} partida{overlay.lineas.length === 1 ? '' : 's'}:
              </div>
              {overlay.lineas.map((l) => (
                <div key={l.id} className="flex justify-between gap-2 font-normal">
                  <span className="truncate">
                    · {l.ingresoMercaderia ? fmtFecha(l.ingresoMercaderia.fechaHora) : 'sin fecha'}
                    {l.ingresoMercaderia ? ` — ${l.ingresoMercaderia.proveedor.nombre}` : ''}
                  </span>
                  <span className="shrink-0 font-bold">
                    {fmtNumero(l.cantidadRestanteDisponible)}{' '}
                    {unidadTexto(overlay.producto.unidadDeMedida, l.cantidadRestanteDisponible)}
                  </span>
                </div>
              ))}
            </div>
          }
          mensajeMaximo={`No alcanza. Entre todas las partidas tenés ${fmtNumero(overlay.totalDisponible)} ${unidadTexto(overlay.producto.unidadDeMedida, overlay.totalDisponible)}.`}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(deseado) => {
            const entradas = calcularReparto(deseado, overlay.lineas);
            setOverlay({ tipo: 'revisarReparto', producto: overlay.producto, deseado, todasLasLineas: overlay.lineas, entradas });
          }}
        />
      )}

      {overlay?.tipo === 'revisarReparto' && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
          <div className="flex max-h-[85%] w-full flex-col gap-3 overflow-hidden rounded-t-3xl bg-white p-5 sm:max-w-md sm:rounded-3xl">
            <div className="text-lg font-extrabold">Así se reparte — {overlay.producto.nombre}</div>
            <div className="text-sm text-texto-suave">
              {fmtNumero(overlay.deseado)} {unidadTexto(overlay.producto.unidadDeMedida, overlay.deseado)} en total, de la
              partida más vieja a la más nueva. Podés ajustar cualquiera con ✎.
            </div>
            <div className="flex flex-col gap-2 overflow-auto">
              {overlay.entradas.map((e, idx) => (
                <div key={e.linea.id} className="flex items-center gap-2.5 rounded-2xl border border-borde bg-panel px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setOverlay({
                        tipo: 'tecladoEditarEntrada',
                        producto: overlay.producto,
                        deseado: overlay.deseado,
                        todasLasLineas: overlay.todasLasLineas,
                        entradas: overlay.entradas,
                        indice: idx,
                      })
                    }
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <div className="truncate text-[15px] font-bold">
                      Partida del {e.linea.ingresoMercaderia ? fmtFecha(e.linea.ingresoMercaderia.fechaHora) : '?'} —{' '}
                      {e.linea.ingresoMercaderia?.proveedor.nombre ?? ''}
                    </div>
                    <div className="text-sm text-texto-suave">
                      {fmtNumero(e.cantidad)} {unidadTexto(overlay.producto.unidadDeMedida, e.cantidad)} de{' '}
                      {fmtNumero(e.linea.cantidadRestanteDisponible)} disponibles
                    </div>
                  </button>
                  {/* El renglón entero ya era editable, pero nadie lo descubría:
                      el ✎ hace visible que el reparto automático se puede tocar. */}
                  <button
                    type="button"
                    aria-label="Editar cuánto sale de esta partida"
                    onClick={() =>
                      setOverlay({
                        tipo: 'tecladoEditarEntrada',
                        producto: overlay.producto,
                        deseado: overlay.deseado,
                        todasLasLineas: overlay.todasLasLineas,
                        entradas: overlay.entradas,
                        indice: idx,
                      })
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-borde-fuerte bg-white text-base hover:bg-chip"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label="Sacar esta partida del reparto"
                    onClick={() => {
                      const sinEsta = overlay.entradas.filter((_, j) => j !== idx);
                      const reajustadas = reajustarReparto(sinEsta, overlay.deseado, overlay.todasLasLineas);
                      setOverlay({ ...overlay, entradas: reajustadas });
                    }}
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-red-200 bg-white text-base font-bold text-error hover:bg-error-suave"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {overlay.entradas.length === 0 && (
                <div className="py-4 text-center text-sm text-texto-suave">No queda ninguna partida en el reparto.</div>
              )}
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="min-h-14 flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={overlay.entradas.length === 0}
                onClick={() => {
                  setInsumos((is) => [
                    ...is,
                    ...overlay.entradas.map((e) => ({
                      producto: overlay.producto,
                      linea: e.linea,
                      cantidadUsada: e.cantidad,
                    })),
                  ]);
                  setOverlay(null);
                }}
                className="min-h-14 flex-[2] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white disabled:opacity-50"
              >
                AGREGAR ESTOS INSUMOS
              </button>
            </div>
          </div>
        </div>
      )}

      {overlay?.tipo === 'tecladoEditarEntrada' && (
        <TecladoNumerico
          titulo="Ajustar esta partida"
          subtitulo={overlay.producto.nombre}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          valorInicial={overlay.entradas[overlay.indice]!.cantidad}
          maximo={Number(overlay.entradas[overlay.indice]!.linea.cantidadRestanteDisponible)}
          pistaDisponible={`Esta partida tiene ${fmtNumero(overlay.entradas[overlay.indice]!.linea.cantidadRestanteDisponible)} ${unidadTexto(overlay.producto.unidadDeMedida, overlay.entradas[overlay.indice]!.linea.cantidadRestanteDisponible)} disponibles.`}
          mensajeMaximo={`Esta partida tiene ${fmtNumero(overlay.entradas[overlay.indice]!.linea.cantidadRestanteDisponible)} ${unidadTexto(overlay.producto.unidadDeMedida, overlay.entradas[overlay.indice]!.linea.cantidadRestanteDisponible)}.`}
          onCancelar={() =>
            setOverlay({
              tipo: 'revisarReparto',
              producto: overlay.producto,
              deseado: overlay.deseado,
              todasLasLineas: overlay.todasLasLineas,
              entradas: overlay.entradas,
            })
          }
          onConfirmar={(cantidad) => {
            const editadas = overlay.entradas.map((e, j) => (j === overlay.indice ? { ...e, cantidad } : e));
            const reajustadas = reajustarReparto(editadas, overlay.deseado, overlay.todasLasLineas, overlay.indice);
            setOverlay({
              tipo: 'revisarReparto',
              producto: overlay.producto,
              deseado: overlay.deseado,
              todasLasLineas: overlay.todasLasLineas,
              entradas: reajustadas,
            });
          }}
        />
      )}

      {/* ── Editar cantidad de un insumo ya cargado en la lista final ── */}
      {overlay?.tipo === 'tecladoEditarCargado' && insumos[overlay.indice] && (
        <TecladoNumerico
          titulo="Modificar cantidad"
          subtitulo={insumos[overlay.indice]!.producto.nombre}
          unidad={insumos[overlay.indice]!.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={insumos[overlay.indice]!.producto.unidadDeMedida === 'KG'}
          valorInicial={insumos[overlay.indice]!.cantidadUsada}
          maximo={Number(insumos[overlay.indice]!.linea.cantidadRestanteDisponible)}
          pistaDisponible={`Esta partida tiene ${fmtNumero(insumos[overlay.indice]!.linea.cantidadRestanteDisponible)} ${unidadTexto(insumos[overlay.indice]!.producto.unidadDeMedida, insumos[overlay.indice]!.linea.cantidadRestanteDisponible)} disponibles.`}
          mensajeMaximo={`No alcanza. En esa partida quedan ${fmtNumero(insumos[overlay.indice]!.linea.cantidadRestanteDisponible)} ${unidadTexto(insumos[overlay.indice]!.producto.unidadDeMedida, insumos[overlay.indice]!.linea.cantidadRestanteDisponible)}.`}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            const idx = overlay.indice;
            setInsumos((is) => is.map((i, j) => (j === idx ? { ...i, cantidadUsada: cantidad } : i)));
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
