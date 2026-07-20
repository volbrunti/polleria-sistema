import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarProductos, tablasPrecioVigentes } from '../../../api/productos';
import { confirmarPedido, masVendidos } from '../../../api/pedidos';
import { calcularPrecioTotal, type TierPrecio } from '../../../lib/precios';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import { CobrarPedido } from './CobrarPedido';
import type { AvisoStockMinimo, Pedido, Producto, TipoPedido } from '../../../api/types';

interface Props {
  sucursalId: number;
}

interface LineaCarrito {
  producto: Producto;
  cantidad: number;
}

// POS táctil (CLAUDE-MODULO-2.md §4.1, INNEGOCIABLE): botones grandes por
// categoría, productos ordenados por MÁS VENDIDOS (ranking del backend, no
// manual), carrito siempre visible, total en tiempo real.
export function POS({ sucursalId }: Props) {
  const queryClient = useQueryClient();

  const productosQ = useQuery({ queryKey: ['productos'], queryFn: () => listarProductos({ activo: true }) });
  const preciosQ = useQuery({ queryKey: ['precios-vigentes'], queryFn: tablasPrecioVigentes });
  const rankingQ = useQuery({
    queryKey: ['mas-vendidos', sucursalId],
    queryFn: () => masVendidos(sucursalId),
    staleTime: 5 * 60 * 1000,
  });

  const tablaPorProducto = useMemo(() => {
    const mapa = new Map<number, TierPrecio[]>();
    for (const fila of preciosQ.data ?? []) {
      mapa.set(
        fila.productoId,
        fila.precios.map((p) => ({ cantidad: p.cantidad, monto: Number(p.monto) })),
      );
    }
    return mapa;
  }, [preciosQ.data]);

  const rankingPorProducto = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const r of rankingQ.data ?? []) mapa.set(r.productoId, Number(r.unidades));
    return mapa;
  }, [rankingQ.data]);

  // Vendibles: todo lo que no es materia prima Y tiene precio cargado
  const vendibles = useMemo(
    () =>
      (productosQ.data ?? [])
        .filter((p) => p.tipo !== 'MATERIA_PRIMA' && tablaPorProducto.has(p.id))
        .sort((a, b) => (rankingPorProducto.get(b.id) ?? 0) - (rankingPorProducto.get(a.id) ?? 0)),
    [productosQ.data, tablaPorProducto, rankingPorProducto],
  );

  const categorias = useMemo(() => {
    const vistas = new Set<string>();
    // El orden de categorías también sigue al ranking: la primera categoría es
    // la del producto más vendido (vendibles ya viene ordenado)
    for (const p of vendibles) vistas.add(p.categoria);
    return [...vistas];
  }, [vendibles]);

  const [categoria, setCategoria] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoPedido>('PRESENCIAL');
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisoStockMinimo[] | null>(null);
  const [pedidoACobrar, setPedidoACobrar] = useState<Pedido | null>(null);
  const [vueltoFinal, setVueltoFinal] = useState<string | null>(null);
  const [confirmadoSinCobro, setConfirmadoSinCobro] = useState(false);

  const visibles = categoria ? vendibles.filter((p) => p.categoria === categoria) : vendibles;

  function agregar(producto: Producto) {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.producto.id === producto.id);
      if (idx === -1) return [...c, { producto, cantidad: 1 }];
      return c.map((l, i) => (i === idx ? { ...l, cantidad: l.cantidad + 1 } : l));
    });
  }

  function cambiarCantidad(productoId: number, delta: number) {
    setCarrito((c) =>
      c
        .map((l) => (l.producto.id === productoId ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    );
  }

  const lineasConTotal = carrito.map((l) => ({
    ...l,
    total: calcularPrecioTotal(l.cantidad, tablaPorProducto.get(l.producto.id) ?? []),
  }));
  const haySinPrecio = lineasConTotal.some((l) => l.total === null);
  const totalCarrito = lineasConTotal.reduce((acc, l) => acc + (l.total ?? 0), 0);

  const mutConfirmar = useMutation({
    mutationFn: () =>
      confirmarPedido({
        sucursalId,
        tipo,
        items: carrito.map((l) => ({ productoId: l.producto.id, cantidad: l.cantidad })),
      }),
    onSuccess: (pedido) => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      void queryClient.invalidateQueries({ queryKey: ['mas-vendidos'] });
      setCarrito([]);
      if (pedido.avisosStockMinimo && pedido.avisosStockMinimo.length > 0) {
        setAvisos(pedido.avisosStockMinimo);
      }
      if (tipo === 'PRESENCIAL') setPedidoACobrar(pedido);
      else setConfirmadoSinCobro(true);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo confirmar el pedido.'),
  });

  function precioBoton(p: Producto): string {
    const tabla = tablaPorProducto.get(p.id) ?? [];
    const unitario = tabla.find((t) => t.cantidad === 1);
    if (unitario) return fmtMoneda(unitario.monto);
    const menor = tabla[0];
    return menor ? `${menor.cantidad} × ${fmtMoneda(menor.monto)}` : '—';
  }

  const cargando = productosQ.isLoading || preciosQ.isLoading;

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Grilla de productos ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoria(null)}
            className={`min-h-[46px] cursor-pointer rounded-xl px-4 text-[15px] font-bold ${
              categoria === null ? 'bg-primario text-white' : 'border border-borde-fuerte bg-white text-texto-suave'
            }`}
          >
            Todos
          </button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`min-h-[46px] cursor-pointer rounded-xl px-4 text-[15px] font-bold ${
                categoria === c ? 'bg-primario text-white' : 'border border-borde-fuerte bg-white text-texto-suave'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {cargando ? (
          <div className="p-6 text-center text-texto-suave">Cargando catálogo…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {visibles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => agregar(p)}
                className="flex min-h-[86px] cursor-pointer flex-col items-start justify-between rounded-2xl border border-borde bg-white px-3.5 py-3 text-left hover:border-primario active:bg-chip"
              >
                <span className="text-[15px] font-extrabold leading-tight">{p.nombre}</span>
                <span className="text-sm font-bold text-primario">{precioBoton(p)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Carrito (siempre visible) ── */}
      <div className="flex w-[340px] shrink-0 flex-col border-l border-borde bg-white">
        <div className="flex gap-1.5 p-3">
          {(['PRESENCIAL', 'A_RETIRAR'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`min-h-[46px] flex-1 cursor-pointer rounded-xl text-[15px] font-bold ${
                tipo === t ? 'bg-acento text-texto' : 'border border-borde-fuerte bg-white text-texto-suave'
              }`}
            >
              {t === 'PRESENCIAL' ? 'Presencial' : 'A retirar'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto px-3">
          {carrito.length === 0 ? (
            <div className="p-5 text-center text-[15px] text-texto-suave">
              Tocá los productos para armar el pedido
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {lineasConTotal.map((l) => (
                <div key={l.producto.id} className="rounded-xl border border-borde bg-panel px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] font-extrabold leading-tight">{l.producto.nombre}</span>
                    <span className="text-[15px] font-extrabold">
                      {l.total !== null ? fmtMoneda(l.total) : 'sin precio'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(l.producto.id, -1)}
                      className="h-10 w-10 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-xl font-bold"
                    >
                      −
                    </button>
                    <span className="min-w-8 text-center text-lg font-extrabold">{l.cantidad}</span>
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(l.producto.id, 1)}
                      className="h-10 w-10 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-xl font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-3 rounded-xl bg-error-suave px-3.5 py-3 text-[15px] font-semibold text-error-texto">
            {error}
          </div>
        )}
        {haySinPrecio && (
          <div className="mx-3 mt-2 rounded-xl bg-error-suave px-3.5 py-3 text-[15px] font-semibold text-error-texto">
            Hay una cantidad sin precio cargado — ajustala para poder confirmar.
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-borde p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-texto-suave">Total</span>
            <span className="text-[28px] font-extrabold">{fmtMoneda(totalCarrito)}</span>
          </div>
          <button
            type="button"
            disabled={carrito.length === 0 || haySinPrecio || mutConfirmar.isPending}
            onClick={() => {
              setError(null);
              mutConfirmar.mutate();
            }}
            className="min-h-[60px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutConfirmar.isPending ? 'CONFIRMANDO…' : 'CONFIRMAR PEDIDO'}
          </button>
        </div>
      </div>

      {/* ── Pop-up de stock mínimo: se repite en CADA venta (§6.6) ── */}
      {avisos && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white p-5">
            <div className="text-xl font-extrabold">⚠️ Queda poco stock</div>
            {avisos.map((a) => (
              <div key={a.productoId} className="rounded-xl bg-error-suave px-4 py-3 text-base font-semibold text-error-texto">
                {a.producto}: quedan {a.stockRestante} (mínimo {a.minimo})
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAvisos(null)}
              className="min-h-[56px] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white"
            >
              ENTENDIDO
            </button>
          </div>
        </div>
      )}

      {/* ── Cobro inmediato (PRESENCIAL) ── */}
      {pedidoACobrar && (
        <CobrarPedido
          pedido={pedidoACobrar}
          onCobrado={(vuelto) => {
            setPedidoACobrar(null);
            setVueltoFinal(vuelto);
          }}
          onCancelar={() => setPedidoACobrar(null)}
        />
      )}

      {vueltoFinal !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">Pedido cobrado ✓</div>
            {Number(vueltoFinal) > 0 && (
              <>
                <div className="text-base text-texto-suave">Vuelto</div>
                <div className="text-4xl font-extrabold text-primario">{fmtMoneda(vueltoFinal)}</div>
              </>
            )}
            <button
              type="button"
              onClick={() => setVueltoFinal(null)}
              className="mt-1 min-h-[56px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white"
            >
              LISTO
            </button>
          </div>
        </div>
      )}

      {confirmadoSinCobro && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">Pedido enviado a cocina ✓</div>
            <div className="text-base text-texto-suave">Se cobra cuando el cliente lo retira.</div>
            <button
              type="button"
              onClick={() => setConfirmadoSinCobro(false)}
              className="mt-1 min-h-[56px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white"
            >
              LISTO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
