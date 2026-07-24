import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarProductos, tablasPrecioVigentes } from '../../../api/productos';
import { modificarPedido } from '../../../api/pedidos';
import { calcularPrecioTotal, type TierPrecio } from '../../../lib/precios';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import type { Pedido, Producto } from '../../../api/types';

interface Props {
  pedido: Pedido;
  onCerrar: () => void;
}

interface LineaCarrito {
  producto: Producto;
  cantidad: number;
}

// Editar un pedido EN_PREPARACION/LISTO (backend PATCH /pedidos/:id, ya
// implementado y testeado desde la Fase 3 — esta es la UI que faltaba,
// CLAUDE-MODULO-2.md §0 Fase 9). El backend ajusta stock por la diferencia
// contra la versión anterior y emite ticket de actualización a cocina; acá
// solo se arma la lista COMPLETA de ítems que reemplaza a la anterior.
export function ModificarPedido({ pedido, onCerrar }: Props) {
  const queryClient = useQueryClient();

  const productosQ = useQuery({ queryKey: ['productos'], queryFn: () => listarProductos({ activo: true }) });
  const preciosQ = useQuery({ queryKey: ['precios-vigentes'], queryFn: tablasPrecioVigentes });

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

  const vendibles = useMemo(
    () => (productosQ.data ?? []).filter((p) => p.tipo !== 'MATERIA_PRIMA' && tablaPorProducto.has(p.id)),
    [productosQ.data, tablaPorProducto],
  );

  const [categoria, setCategoria] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<LineaCarrito[]>(() =>
    pedido.items
      .filter((i) => !i.esVentaCostoCero)
      .map((i) => ({
        producto: {
          id: i.productoId,
          nombre: i.producto?.nombre ?? `Producto ${i.productoId}`,
          categoria: '',
          tipo: i.producto?.tipo ?? 'ELABORADO',
          unidadDeMedida: 'UNIDAD',
          activo: true,
        },
        cantidad: Number(i.cantidad),
      })),
  );
  const [error, setError] = useState<string | null>(null);

  const categorias = useMemo(() => {
    const vistas = new Set<string>();
    for (const p of vendibles) vistas.add(p.categoria);
    return [...vistas];
  }, [vendibles]);

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

  const mutModificar = useMutation({
    mutationFn: () =>
      modificarPedido(
        pedido.id,
        carrito.map((l) => ({ productoId: l.producto.id, cantidad: l.cantidad })),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo modificar el pedido.'),
  });

  function precioBoton(p: Producto): string {
    const tabla = tablaPorProducto.get(p.id) ?? [];
    const unitario = tabla.find((t) => t.cantidad === 1);
    if (unitario) return fmtMoneda(unitario.monto);
    const menor = tabla[0];
    return menor ? `${menor.cantidad} × ${fmtMoneda(menor.monto)}` : '—';
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-borde px-4 py-3">
        <div className="text-xl font-extrabold">Modificar pedido #{pedido.id}</div>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto min-h-11 cursor-pointer rounded-xl border border-borde-fuerte bg-white px-4 text-[15px] font-bold text-texto-suave"
        >
          Cancelar
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
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
        </div>

        <div className="flex w-[340px] shrink-0 flex-col border-l border-borde bg-white">
          <div className="flex-1 overflow-auto px-3 pt-3">
            {carrito.length === 0 ? (
              <div className="p-5 text-center text-[15px] text-texto-suave">
                Sin ítems — el pedido quedaría vacío.
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
              Hay una cantidad sin precio cargado — ajustala para poder guardar.
            </div>
          )}

          <div className="flex flex-col gap-2.5 border-t border-borde p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-texto-suave">Total</span>
              <span className="text-[28px] font-extrabold">{fmtMoneda(totalCarrito)}</span>
            </div>
            <button
              type="button"
              disabled={carrito.length === 0 || haySinPrecio || mutModificar.isPending}
              onClick={() => {
                setError(null);
                mutModificar.mutate();
              }}
              className="min-h-[60px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
            >
              {mutModificar.isPending ? 'GUARDANDO…' : 'GUARDAR CAMBIOS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
