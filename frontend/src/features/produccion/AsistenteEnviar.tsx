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
import { ApiError } from '../../api/client';
import { fmtNumero } from '../../lib/formato';
import type { Producto, Sucursal } from '../../api/types';

interface Props {
  onVolver: () => void;
  onFinalizado: () => void;
}

interface LineaEnvioUI {
  producto: Producto;
  cantidad: number;
}

type Overlay = { tipo: 'selectorProducto' } | { tipo: 'tecladoCantidad'; producto: Producto } | null;

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
                <div className="text-sm text-texto-suave">{fmtNumero(l.cantidad, 0)} unidades</div>
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
              <div className="text-sm text-texto-suave">{fmtNumero(l.cantidad, 0)} unidades</div>
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
                lineas: lineas.map((l) => ({ productoId: l.producto.id, cantidadEnviada: l.cantidad })),
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
            setOverlay({ tipo: 'tecladoCantidad', producto });
          }}
        />
      )}

      {overlay?.tipo === 'tecladoCantidad' && (
        <TecladoNumerico
          titulo="¿Cuántas unidades mandás?"
          subtitulo={overlay.producto.nombre}
          unidad="u"
          permiteDecimal={false}
          maximo={stockDe(overlay.producto.id)}
          mensajeMaximo={`No alcanza. En producción quedan ${fmtNumero(stockDe(overlay.producto.id) ?? 0, 0)} unidades.`}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(cantidad) => {
            setLineas((ls) => [...ls, { producto: overlay.producto, cantidad }]);
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
