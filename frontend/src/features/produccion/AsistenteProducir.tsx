import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EncabezadoWizard } from '../../components/ui/EncabezadoWizard';
import { Selector } from '../../components/ui/Selector';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { listarProductos } from '../../api/productos';
import { lineasDisponibles } from '../../api/ingresos';
import { abrirLote } from '../../api/produccion';
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

type Overlay =
  | { tipo: 'selectorInsumo' }
  | { tipo: 'cargandoPartidas'; producto: Producto }
  | { tipo: 'selectorPartida'; producto: Producto; lineas: LineaIngresoDisponible[] }
  | { tipo: 'tecladoCantidad'; producto: Producto; linea: LineaIngresoDisponible }
  | null;

export function AsistenteProducir({ onVolver, onLoteAbierto }: Props) {
  const [paso, setPaso] = useState(1);
  const [productoElaborado, setProductoElaborado] = useState<Producto | null>(null);
  const [insumos, setInsumos] = useState<InsumoUI[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const productosElaborados = useQuery({
    queryKey: ['productos', 'ELABORADO'],
    queryFn: () => listarProductos({ tipo: 'ELABORADO', activo: true }),
  });
  const materiasPrimas = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA', activo: true }),
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

  async function elegirInsumo(producto: Producto) {
    setOverlay({ tipo: 'cargandoPartidas', producto });
    try {
      const lineas = await lineasDisponibles(producto.id);
      setOverlay({ tipo: 'selectorPartida', producto, lineas });
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
          {productosElaborados.isLoading && <div className="text-texto-suave">Cargando…</div>}
          {productosElaborados.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProductoElaborado(p);
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
          <div className="text-[15px] text-texto-suave">Elegí cada insumo y de qué partida lo sacaste.</div>
          {insumos.map((i, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-bold">{i.producto.nombre}</div>
                <div className="text-sm text-texto-suave">
                  Partida #{i.linea.id} · usaste {fmtNumero(i.cantidadUsada)} {i.producto.unidadDeMedida.toLowerCase()}
                </div>
              </div>
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
          <button
            type="button"
            onClick={() => setOverlay({ tipo: 'selectorInsumo' })}
            className="min-h-[62px] w-full cursor-pointer rounded-2xl border-2 border-dashed border-borde-fuerte bg-transparent text-lg font-bold text-primario hover:bg-chip"
          >
            ＋ AGREGAR INSUMO
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
                Partida #{i.linea.id} · usaste {fmtNumero(i.cantidadUsada)} {i.producto.unidadDeMedida.toLowerCase()}
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

      {overlay?.tipo === 'selectorInsumo' && (
        <Selector
          titulo="Elegí el insumo"
          buscable
          items={(materiasPrimas.data ?? []).map((p) => ({ id: p.id, label: p.nombre }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const producto = materiasPrimas.data!.find((p) => p.id === item.id)!;
            void elegirInsumo(producto);
          }}
        />
      )}

      {overlay?.tipo === 'cargandoPartidas' && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/45">
          <div className="w-full rounded-t-3xl bg-white p-6 text-center text-texto-suave">Buscando partidas…</div>
        </div>
      )}

      {overlay?.tipo === 'selectorPartida' && (
        <Selector
          titulo={`Elegí la partida — ${overlay.producto.nombre}`}
          items={overlay.lineas.map((l) => ({
            id: l.id,
            label: `${fmtNumero(l.cantidadRealPesada)} ${l.producto?.unidadDeMedida.toLowerCase()} — llegó el ${
              l.ingresoMercaderia ? fmtFecha(l.ingresoMercaderia.fechaHora) : '?'
            } — ${l.ingresoMercaderia?.proveedor.nombre ?? ''}`,
            sub: `Quedan ${fmtNumero(l.cantidadRestanteDisponible)} ${l.producto?.unidadDeMedida.toLowerCase()}`,
          }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const linea = overlay.lineas.find((l) => l.id === item.id)!;
            setOverlay({ tipo: 'tecladoCantidad', producto: overlay.producto, linea });
          }}
        />
      )}

      {overlay?.tipo === 'tecladoCantidad' && (
        <TecladoNumerico
          titulo="¿Cuánto usaste?"
          subtitulo={overlay.producto.nombre}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          maximo={Number(overlay.linea.cantidadRestanteDisponible)}
          mensajeMaximo={`No alcanza. En esa partida quedan ${fmtNumero(overlay.linea.cantidadRestanteDisponible)} ${overlay.producto.unidadDeMedida.toLowerCase()}.`}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            setInsumos((is) => [...is, { producto: overlay.producto, linea: overlay.linea, cantidadUsada: cantidad }]);
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
