import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EncabezadoWizard } from '../../components/ui/EncabezadoWizard';
import { Selector } from '../../components/ui/Selector';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { PantallaExito } from '../../components/ui/PantallaExito';
import { listarSucursales } from '../../api/sucursales';
import { listarProductos } from '../../api/productos';
import { consultarStock } from '../../api/stock';
import { generarTransferencia } from '../../api/transferencias';
import { lotesDisponibles } from '../../api/produccion';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtNumero } from '../../lib/formato';
import type { LoteDisponible, Producto, Sucursal } from '../../api/types';

interface Props {
  onVolver: () => void;
  onFinalizado: () => void;
}

interface LineaEnvioUI {
  producto: Producto;
  cantidad: number;
  /** Partida de la que sale. Ausente = stock sin lote (reventa, ajustes). */
  lote?: LoteDisponible;
}

type Overlay =
  | { tipo: 'selectorProducto' }
  | { tipo: 'cargandoLotes'; producto: Producto }
  | { tipo: 'selectorLote'; producto: Producto; lotes: LoteDisponible[]; sinLote: number }
  | { tipo: 'tecladoCantidad'; producto: Producto; lote?: LoteDisponible; maximo?: number }
  | null;

export function AsistenteEnviar({ onVolver, onFinalizado }: Props) {
  const [paso, setPaso] = useState(1);
  const [destino, setDestino] = useState<Sucursal | null>(null);
  const [lineas, setLineas] = useState<LineaEnvioUI[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [remitoId, setRemitoId] = useState<number | null>(null);

  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const destinos = sucursales.data?.filter((s) => s.tipo === 'VENTA') ?? [];
  const sucursalProduccion = sucursales.data?.find((s) => s.tipo === 'PRODUCCION');

  const productos = useQuery({
    queryKey: ['productos', 'enviables'],
    queryFn: () => listarProductos({ activo: true }),
    select: (data) => data.filter((p) => p.tipo !== 'MATERIA_PRIMA'),
  });

  const stockProduccion = useQuery({
    queryKey: ['stock', sucursalProduccion?.id],
    queryFn: () => consultarStock(sucursalProduccion!.id),
    enabled: !!sucursalProduccion,
  });

  const mutConfirmar = useMutation({
    mutationFn: generarTransferencia,
    onSuccess: (transferencia) => setRemitoId(transferencia.id),
    onError: (err) => setErrorEnvio(err instanceof ApiError ? err.message : 'No se pudo generar el envío.'),
  });

  if (remitoId != null) {
    return (
      <PantallaExito
        titulo="Envío confirmado"
        subtitulo={`Remito virtual T-${remitoId} a ${destino?.nombre}.`}
        onContinuar={onFinalizado}
      />
    );
  }

  function volver() {
    if (paso === 1) return onVolver();
    setPaso((p) => p - 1);
  }

  function stockDe(productoId: number): number | undefined {
    const fila = stockProduccion.data?.find((r) => r.productoId === productoId);
    return fila ? Number(fila.cantidad) : undefined;
  }

  // Cuánto de ese producto ya está comprometido en el envío que se está armando
  function yaEnElEnvio(productoId: number, loteId?: number): number {
    return lineas
      .filter((l) => l.producto.id === productoId && l.lote?.id === loteId)
      .reduce((acc, l) => acc + l.cantidad, 0);
  }

  // Al elegir producto se buscan sus partidas. Si no hay ninguna con saldo
  // (reventa, ajustes, o stock producido antes de que el lote llevara saldo),
  // se envía sin lote como siempre.
  async function elegirProducto(producto: Producto) {
    setOverlay({ tipo: 'cargandoLotes', producto });
    try {
      const lotes = await lotesDisponibles(producto.id);
      const conSaldo = lotes.filter(
        (l) => Number(l.cantidadRestanteDisponible) - yaEnElEnvio(producto.id, l.id) > 0,
      );
      const enLotes = lotes.reduce((acc, l) => acc + Number(l.cantidadRestanteDisponible), 0);
      const sinLote = Math.max(0, (stockDe(producto.id) ?? 0) - enLotes);
      if (conSaldo.length === 0) {
        setOverlay({ tipo: 'tecladoCantidad', producto, maximo: stockDe(producto.id) });
        return;
      }
      setOverlay({ tipo: 'selectorLote', producto, lotes: conSaldo, sinLote });
    } catch {
      setOverlay({ tipo: 'tecladoCantidad', producto, maximo: stockDe(producto.id) });
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <EncabezadoWizard titulo="Enviar a local" paso={paso} totalPasos={3} onVolver={volver} />

      {paso === 1 && (
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">¿A dónde lo mandás?</div>
          {destinos.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setDestino(s);
                setPaso(2);
              }}
              className="min-h-[110px] w-full cursor-pointer rounded-2xl border-2 border-borde bg-white text-[26px] font-extrabold tracking-wide hover:border-primario"
            >
              {s.nombre.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">¿Qué mandás a {destino?.nombre}?</div>
          <div className="text-[15px] text-texto-suave">Cantidades en unidades.</div>
          {lineas.map((l, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-bold">{l.producto.nombre}</div>
                <div className="text-sm text-texto-suave">
                  {fmtNumero(l.cantidad, 0)} unidades
                  {l.lote ? ` · partida del ${fmtFecha(l.lote.fechaHora)}` : ' · sin partida'}
                </div>
              </div>
              <button
                type="button"
                aria-label="Borrar"
                onClick={() => setLineas((ls) => ls.filter((_, idx) => idx !== i))}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-red-200 bg-white text-lg font-bold text-error hover:bg-error-suave"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOverlay({ tipo: 'selectorProducto' })}
            className="min-h-[62px] w-full cursor-pointer rounded-2xl border-2 border-dashed border-borde-fuerte bg-transparent text-lg font-bold text-primario hover:bg-chip"
          >
            ＋ AGREGAR PRODUCTO
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={lineas.length === 0}
            onClick={() => setPaso(3)}
            className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white disabled:opacity-50"
          >
            CONTINUAR
          </button>
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Revisá el envío</div>
          <div className="rounded-2xl border border-borde bg-white p-4">
            <div className="text-[15px] text-texto-suave">Destino</div>
            <div className="text-xl font-extrabold">{destino?.nombre}</div>
          </div>
          {lineas.map((l, i) => (
            <div key={i} className="rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="text-[17px] font-bold">{l.producto.nombre}</div>
              <div className="text-sm text-texto-suave">
                {fmtNumero(l.cantidad, 0)} unidades
                {l.lote ? ` · partida del ${fmtFecha(l.lote.fechaHora)} (lote ${l.lote.id})` : ' · sin partida'}
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
            disabled={mutConfirmar.isPending}
            onClick={() => {
              setErrorEnvio(null);
              mutConfirmar.mutate({
                sucursalDestinoId: destino!.id,
                lineas: lineas.map((l) => ({
                  productoId: l.producto.id,
                  cantidadEnviada: l.cantidad,
                  loteOrigenId: l.lote?.id,
                })),
              });
            }}
            className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutConfirmar.isPending ? 'ENVIANDO…' : 'CONFIRMAR ENVÍO'}
          </button>
        </div>
      )}

      {overlay?.tipo === 'selectorProducto' && (
        <Selector
          titulo="Elegí el producto"
          buscable
          items={(productos.data ?? []).map((p) => ({ id: p.id, label: p.nombre, sub: `Stock: ${fmtNumero(stockDe(p.id) ?? 0, 0)}` }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const producto = productos.data!.find((p) => p.id === item.id)!;
            void elegirProducto(producto);
          }}
        />
      )}

      {overlay?.tipo === 'cargandoLotes' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/45">
          <div className="rounded-2xl bg-white px-6 py-5 text-base font-bold text-texto-suave">
            Buscando partidas…
          </div>
        </div>
      )}

      {/* Elegir de qué partida sale. Van de la más vieja a la más nueva —
          Pablo lo pidió así: "no le mandé las que produjeron hoy a la mañana,
          sino las de ayer". */}
      {overlay?.tipo === 'selectorLote' && (
        <Selector
          titulo={`¿De qué partida? — ${overlay.producto.nombre}`}
          items={[
            ...overlay.lotes.map((l) => ({
              id: l.id,
              label: `Producido el ${fmtFecha(l.fechaHora)}`,
              sub: `Quedan ${fmtNumero(
                Number(l.cantidadRestanteDisponible) - yaEnElEnvio(overlay.producto.id, l.id),
                0,
              )} u · lote ${l.id} · ${l.operario}`,
            })),
            ...(overlay.sinLote > 0
              ? [
                  {
                    id: 'sinLote',
                    label: 'Stock sin partida',
                    sub: `${fmtNumero(overlay.sinLote, 0)} u — anterior al registro por lote`,
                  },
                ]
              : []),
          ]}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            if (item.id === 'sinLote') {
              setOverlay({ tipo: 'tecladoCantidad', producto: overlay.producto, maximo: overlay.sinLote });
              return;
            }
            const lote = overlay.lotes.find((l) => l.id === item.id)!;
            setOverlay({
              tipo: 'tecladoCantidad',
              producto: overlay.producto,
              lote,
              maximo:
                Number(lote.cantidadRestanteDisponible) - yaEnElEnvio(overlay.producto.id, lote.id),
            });
          }}
        />
      )}

      {overlay?.tipo === 'tecladoCantidad' && (
        <TecladoNumerico
          titulo="¿Cuántas unidades mandás?"
          subtitulo={
            overlay.lote
              ? `${overlay.producto.nombre} — partida del ${fmtFecha(overlay.lote.fechaHora)}`
              : overlay.producto.nombre
          }
          unidad="u"
          permiteDecimal={false}
          maximo={overlay.maximo}
          mensajeMaximo={
            overlay.lote
              ? `En esa partida quedan ${fmtNumero(overlay.maximo ?? 0, 0)} unidades.`
              : `No alcanza. En producción quedan ${fmtNumero(overlay.maximo ?? 0, 0)} unidades.`
          }
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            setLineas((ls) => [...ls, { producto: overlay.producto, cantidad, lote: overlay.lote }]);
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
