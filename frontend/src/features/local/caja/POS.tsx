import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarProductos, tablasPrecioVigentes } from '../../../api/productos';
import { confirmarPedido, masVendidos } from '../../../api/pedidos';
import { calcularPrecioTotal, type TierPrecio } from '../../../lib/precios';
import { nuevoToken } from '../../../lib/idempotencia';
import { fmtMoneda } from '../../../lib/formato';
import { normalizar } from '../../../lib/texto';
import { ApiError } from '../../../api/client';
import { CobrarPedido } from './CobrarPedido';
import { SelectorHorario } from './SelectorHorario';
import type { AvisoStockMinimo, Pedido, Producto, TipoPedido } from '../../../api/types';

interface Props {
  sucursalId: number;
}

interface LineaCarrito {
  producto: Producto;
  cantidad: number;
}

// Productos sin agrupador cargado (los da de alta el admin y puede olvidarse).
const SIN_MADRE = 'Otros';

function Chip({
  activo,
  chico,
  onClick,
  children,
}: {
  activo: boolean;
  chico?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-xl font-bold ${
        chico ? 'min-h-[40px] px-3.5 text-sm' : 'min-h-[46px] px-4 text-[15px]'
      } ${activo ? 'bg-primario text-white' : 'border border-borde-fuerte bg-white text-texto-suave'}`}
    >
      {children}
    </button>
  );
}

// POS táctil (CLAUDE.md §5 Flujo 4, INNEGOCIABLE): botones grandes por
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

  // Dos niveles (reunión 4/8): 16 categorías vendibles no entran en una fila
  // de chips. El cajero elige primero la madre y ahí se abren sus categorías.
  // Ambos órdenes siguen al ranking — vendibles ya viene ordenado por ventas.
  const madres = useMemo(() => {
    const vistas = new Set<string>();
    for (const p of vendibles) vistas.add(p.categoriaMadre ?? SIN_MADRE);
    return [...vistas];
  }, [vendibles]);

  const [madre, setMadre] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const deLaMadre = useMemo(
    () => (madre ? vendibles.filter((p) => (p.categoriaMadre ?? SIN_MADRE) === madre) : vendibles),
    [vendibles, madre],
  );

  const categorias = useMemo(() => {
    const vistas = new Set<string>();
    for (const p of deLaMadre) vistas.add(p.categoria);
    return [...vistas];
  }, [deLaMadre]);

  // Fila fija de lo que más se vende: NO se filtra al cambiar de categoría —
  // es el atajo del 80% de los pedidos (Ariel: "el pollo y las papas").
  const destacados = useMemo(
    () => vendibles.filter((p) => (rankingPorProducto.get(p.id) ?? 0) > 0).slice(0, 8),
    [vendibles, rankingPorProducto],
  );
  const [tipo, setTipo] = useState<TipoPedido>('PRESENCIAL');
  // Nombre y hora prometida — se piden al confirmar (no al cobrar) porque el
  // ticket a cocina se imprime en ese momento (pedido post-prueba en vivo).
  // El nombre es OBLIGATORIO: es con lo que se llama al cliente y con lo que
  // se lo busca en Pedidos activos.
  const [nombreCliente, setNombreCliente] = useState('');
  const [horaEntrega, setHoraEntrega] = useState('');
  const [eligiendoHora, setEligiendoHora] = useState(false);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisoStockMinimo[] | null>(null);
  const [pedidoACobrar, setPedidoACobrar] = useState<Pedido | null>(null);
  const [vueltoFinal, setVueltoFinal] = useState<string | null>(null);
  const [confirmadoSinCobro, setConfirmadoSinCobro] = useState(false);
  // Solo aplica en celular: en tablet/escritorio el carrito está siempre a la vista.
  const [carritoAbierto, setCarritoAbierto] = useState(false);

  // Buscando: la búsqueda pisa los filtros y busca en TODO el catálogo, para
  // no obligar al cajero a acordarse en qué categoría está lo que escribió.
  const buscando = busqueda.trim().length > 0;
  const visibles = buscando
    ? vendibles.filter((p) => normalizar(p.nombre).includes(normalizar(busqueda)))
    : categoria
      ? deLaMadre.filter((p) => p.categoria === categoria)
      : deLaMadre;

  // Token de idempotencia: uno por pedido armado. Se renueva cuando el
  // carrito arranca de cero — un retry del MISMO carrito reusa el token y el
  // backend devuelve el pedido ya creado en vez de duplicarlo.
  const tokenPedido = useRef(nuevoToken());

  function agregar(producto: Producto) {
    setCarrito((c) => {
      if (c.length === 0) tokenPedido.current = nuevoToken();
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

  // Previsualización con la tabla de volumen (mismo greedy que el backend en
  // pedidos.calculos.ts). La autoridad del precio sigue siendo el POST; los
  // descuentos se aplican después, en la pantalla de cobro.
  const lineasConTotal = carrito.map((l) => ({
    ...l,
    total: calcularPrecioTotal(l.cantidad, tablaPorProducto.get(l.producto.id) ?? []),
  }));
  const haySinPrecio = lineasConTotal.some((l) => l.total === null);
  const totalCarrito = lineasConTotal.reduce((acc, l) => acc + (l.total ?? 0), 0);
  // El nombre del cliente es regla de negocio: sin nombre no se confirma.
  const faltaNombre = nombreCliente.trim().length === 0;

  const mutConfirmar = useMutation({
    mutationFn: () =>
      confirmarPedido({
        sucursalId,
        tipo,
        items: carrito.map((l) => ({ productoId: l.producto.id, cantidad: l.cantidad })),
        tokenIdempotencia: tokenPedido.current,
        nombreCliente: nombreCliente.trim(),
        ...(horaEntrega ? { horaEntregaSolicitada: horaEntrega } : {}),
      }),
    onSuccess: (pedido) => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      void queryClient.invalidateQueries({ queryKey: ['mas-vendidos'] });
      setCarrito([]);
      setCarritoAbierto(false); // en celular, vuelve a la grilla de productos
      setNombreCliente('');
      setHoraEntrega('');
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
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* ── Grilla de productos ── */}
      {/* pb-24 en celular: deja aire para la barra fija del pedido */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4 pb-24 md:pb-4">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto…"
          className="min-h-[50px] w-full rounded-xl border border-borde-fuerte bg-white px-4 text-base font-semibold"
        />

        {destacados.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-extrabold tracking-wide text-texto-suave">LO QUE MÁS SE VENDE</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {destacados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => agregar(p)}
                  className="flex min-h-[62px] w-[152px] shrink-0 cursor-pointer flex-col items-start justify-between rounded-2xl border-2 border-acento bg-advertencia-suave px-3 py-2 text-left active:bg-acento"
                >
                  <span className="text-[14px] font-extrabold leading-tight">{p.nombre}</span>
                  <span className="text-[13px] font-bold text-advertencia-texto">{precioBoton(p)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!buscando && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Chip activo={madre === null} onClick={() => { setMadre(null); setCategoria(null); }}>
                Todo
              </Chip>
              {madres.map((m) => (
                <Chip
                  key={m}
                  activo={madre === m}
                  onClick={() => { setMadre(m); setCategoria(null); }}
                >
                  {m}
                </Chip>
              ))}
            </div>

            {/* Segundo nivel: solo si la madre tiene más de una categoría */}
            {madre !== null && categorias.length > 1 && (
              <div className="flex flex-wrap gap-2 border-l-4 border-chip pl-2.5">
                <Chip chico activo={categoria === null} onClick={() => setCategoria(null)}>
                  Todas
                </Chip>
                {categorias.map((c) => (
                  <Chip key={c} chico activo={categoria === c} onClick={() => setCategoria(c)}>
                    {c}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        {cargando ? (
          <div className="p-6 text-center text-texto-suave">Cargando catálogo…</div>
        ) : visibles.length === 0 ? (
          <div className="p-6 text-center text-texto-suave">
            {buscando ? `No hay ningún producto que se llame "${busqueda}".` : 'No hay productos acá.'}
          </div>
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

      {/* ── Carrito ──
          En tablet/escritorio va como panel lateral fijo, siempre visible.
          En celular, 340px fijos dejaban 32px para los productos: ahí pasa a
          ser una hoja que se abre desde la barra inferior. */}
      <div
        className={`flex-col border-borde bg-white md:static md:flex md:w-[340px] md:shrink-0 md:border-l ${
          carritoAbierto ? 'fixed inset-0 z-30 flex overflow-y-auto' : 'hidden'
        }`}
      >
        {/* Encabezado de la hoja, solo en celular */}
        <div className="flex items-center justify-between border-b border-borde px-4 py-3 md:hidden">
          <span className="text-lg font-extrabold">El pedido</span>
          <button
            type="button"
            onClick={() => setCarritoAbierto(false)}
            className="min-h-11 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave"
          >
            SEGUIR CARGANDO
          </button>
        </div>

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

        {/* Nombre (OBLIGATORIO) y hora prometida (opcional), para ambos tipos
            de pedido — confirmado por Ariel: aplica también a PRESENCIAL, no
            solo a retirar. Van a la comandera de cocina. La hora sale del
            selector de horarios fijos (SelectorHorario) — nada de tipeo libre. */}
        <div className="flex gap-1.5 px-3 pb-3">
          <input
            value={nombreCliente}
            onChange={(e) => setNombreCliente(e.target.value)}
            placeholder="Nombre del cliente"
            className={`h-11 min-w-0 flex-[2] rounded-xl border px-3 text-[15px] ${
              faltaNombre && carrito.length > 0 ? 'border-error' : 'border-borde-fuerte'
            }`}
          />
          <button
            type="button"
            onClick={() => setEligiendoHora(true)}
            className={`h-11 min-w-0 flex-1 cursor-pointer rounded-xl border px-2 text-[15px] font-semibold ${
              horaEntrega
                ? 'border-primario bg-primario-suave text-primario'
                : 'border-borde-fuerte text-texto-suave'
            }`}
          >
            {horaEntrega || 'Hora'}
          </button>
        </div>

        <div className="flex-1 overflow-auto border-t border-borde px-3 pt-3">
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
          {faltaNombre && carrito.length > 0 && (
            <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-[14px] font-semibold text-error-texto">
              Poné el nombre del cliente para confirmar.
            </div>
          )}
          <button
            type="button"
            disabled={carrito.length === 0 || haySinPrecio || faltaNombre || mutConfirmar.isPending}
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

      {eligiendoHora && (
        <SelectorHorario
          valor={horaEntrega}
          onElegir={(hora) => {
            setHoraEntrega(hora);
            setEligiendoHora(false);
          }}
          onQuitar={() => {
            setHoraEntrega('');
            setEligiendoHora(false);
          }}
          onCancelar={() => setEligiendoHora(false)}
        />
      )}

      {/* ── Barra del pedido: solo en celular, con el carrito cerrado ──
          Reemplaza al panel lateral, que en pantalla chica no entra. Muestra
          lo único que el cajero necesita de un vistazo mientras carga:
          cuántos ítems lleva y cuánto va. */}
      {!carritoAbierto && (
        <button
          type="button"
          onClick={() => setCarritoAbierto(true)}
          className="fixed inset-x-0 bottom-0 z-20 flex min-h-[68px] cursor-pointer items-center gap-3 border-t border-borde bg-white px-4 py-2.5 text-left md:hidden"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-texto-suave">
              {carrito.length === 0
                ? 'Sin productos todavía'
                : `${carrito.length} ${carrito.length === 1 ? 'producto' : 'productos'}`}
            </div>
            <div className="text-xl font-extrabold">{fmtMoneda(totalCarrito)}</div>
          </div>
          <span
            className={`flex min-h-12 items-center rounded-2xl px-5 text-base font-extrabold ${
              carrito.length === 0 ? 'bg-chip text-texto-suave' : 'bg-primario text-white'
            }`}
          >
            VER PEDIDO
          </span>
        </button>
      )}

      {/* ── Pop-up de stock mínimo: se repite en CADA venta (§6.6) ── */}
      {avisos && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white p-5">
            <div className="text-xl font-extrabold">Queda poco stock</div>
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
