import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarProductos, tablasPrecioVigentes } from '../../../api/productos';
import { listarConfiguracion, CLAVE_DESCUENTO_EMPLEADO } from '../../../api/configuracion';
import { cobrarPedido, confirmarPedido, masVendidos } from '../../../api/pedidos';
import { calcularPrecioTotal, type TierPrecio } from '../../../lib/precios';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import { CobrarPedido } from './CobrarPedido';
import type {
  AvisoStockMinimo,
  BeneficiarioPedido,
  Pedido,
  Producto,
  SocioRetiro,
  TipoPedido,
} from '../../../api/types';

const SOCIOS: SocioRetiro[] = ['ARIEL', 'ELIANA', 'EMA'];

interface Props {
  sucursalId: number;
}

interface LineaCarrito {
  producto: Producto;
  cantidad: number;
}

// Productos sin agrupador cargado (los da de alta el admin y puede olvidarse).
const SIN_MADRE = 'Otros';

// Búsqueda tolerante a tildes: "milanesa napolitana" tiene que salir con
// "napolitana" y también con "napolitana" escrito sin acento.
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

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

function BotonBeneficiario({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[42px] flex-1 cursor-pointer rounded-xl text-sm font-bold ${
        activo ? 'bg-texto text-white' : 'border border-borde-fuerte bg-white text-texto-suave'
      }`}
    >
      {children}
    </button>
  );
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
  const configQ = useQuery({
    queryKey: ['configuracion'],
    queryFn: listarConfiguracion,
    staleTime: 10 * 60 * 1000,
  });
  const descuentoEmpleadoPct = Number(
    configQ.data?.find((c) => c.clave === CLAVE_DESCUENTO_EMPLEADO)?.valor ?? 0,
  );

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
  // Retiro de socio / venta a empleado (reunión 4/8). null = venta normal.
  const [beneficiario, setBeneficiario] = useState<BeneficiarioPedido | null>(null);
  const [socio, setSocio] = useState<SocioRetiro | null>(null);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisoStockMinimo[] | null>(null);
  const [pedidoACobrar, setPedidoACobrar] = useState<Pedido | null>(null);
  const [vueltoFinal, setVueltoFinal] = useState<string | null>(null);
  const [confirmadoSinCobro, setConfirmadoSinCobro] = useState(false);
  const [retiroConfirmado, setRetiroConfirmado] = useState<Pedido | null>(null);

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
  const tokenPedido = useRef(crypto.randomUUID());

  function agregar(producto: Producto) {
    setCarrito((c) => {
      if (c.length === 0) tokenPedido.current = crypto.randomUUID();
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

  // Mismo criterio que el backend (pedidos.calculos.ts): el socio se lo lleva
  // a costo cero, el empleado paga con el descuento configurado redondeado
  // hacia abajo. Acá es solo la previsualización — la autoridad es el POST.
  function conBeneficio(precio: number): number {
    if (beneficiario === 'SOCIO') return 0;
    if (beneficiario === 'EMPLEADO' && descuentoEmpleadoPct > 0) {
      return Math.floor((precio * (100 - descuentoEmpleadoPct)) / 100);
    }
    return precio;
  }

  const lineasConTotal = carrito.map((l) => {
    const lista = calcularPrecioTotal(l.cantidad, tablaPorProducto.get(l.producto.id) ?? []);
    return { ...l, lista, total: lista === null ? null : conBeneficio(lista) };
  });
  const haySinPrecio = lineasConTotal.some((l) => l.total === null);
  const totalLista = lineasConTotal.reduce((acc, l) => acc + (l.lista ?? 0), 0);
  const totalCarrito = lineasConTotal.reduce((acc, l) => acc + (l.total ?? 0), 0);
  // Falta elegir el socio: no se puede confirmar un retiro sin decir de quién.
  const faltaSocio = beneficiario === 'SOCIO' && socio === null;

  const mutConfirmar = useMutation({
    mutationFn: () =>
      confirmarPedido({
        sucursalId,
        tipo,
        items: carrito.map((l) => ({ productoId: l.producto.id, cantidad: l.cantidad })),
        tokenIdempotencia: tokenPedido.current,
        ...(beneficiario ? { beneficiario } : {}),
        ...(beneficiario === 'SOCIO' && socio ? { socioBeneficiario: socio } : {}),
      }),
    onSuccess: (pedido) => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      void queryClient.invalidateQueries({ queryKey: ['mas-vendidos'] });
      setCarrito([]);
      const eraRetiroDeSocio = beneficiario === 'SOCIO';
      setBeneficiario(null);
      setSocio(null);
      if (pedido.avisosStockMinimo && pedido.avisosStockMinimo.length > 0) {
        setAvisos(pedido.avisosStockMinimo);
      }
      // El retiro del socio no se cobra: se cierra solo y no abre la pantalla
      // de cobro (la maneja cobrarPedido con pagos vacíos).
      if (eraRetiroDeSocio) setRetiroConfirmado(pedido);
      else if (tipo === 'PRESENCIAL') setPedidoACobrar(pedido);
      else setConfirmadoSinCobro(true);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo confirmar el pedido.'),
  });

  // Cierra el retiro del socio sin pagos: queda ENTREGADO igual que un cobro.
  const mutCerrarRetiro = useMutation({
    mutationFn: (pedidoId: number) => cobrarPedido(pedidoId, []),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      setRetiroConfirmado(null);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'El retiro quedó abierto — cerralo desde Pedidos.'),
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
        <div className="relative">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            className="min-h-[50px] w-full rounded-xl border border-borde-fuerte bg-white pl-11 pr-4 text-base font-semibold"
          />
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-texto-suave">
            🔍
          </span>
        </div>

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

        {/* Retiro de socio / venta a empleado (reunión 4/8). El retiro de
            PLATA sigue en Operaciones de caja — acá va solo la mercadería. */}
        <div className="flex flex-col gap-2 border-t border-borde px-3 pb-3">
          <div className="flex gap-1.5 pt-3">
            <BotonBeneficiario
              activo={beneficiario === null}
              onClick={() => {
                setBeneficiario(null);
                setSocio(null);
              }}
            >
              Cliente
            </BotonBeneficiario>
            <BotonBeneficiario
              activo={beneficiario === 'SOCIO'}
              onClick={() => setBeneficiario('SOCIO')}
            >
              Socio
            </BotonBeneficiario>
            <BotonBeneficiario
              activo={beneficiario === 'EMPLEADO'}
              onClick={() => {
                setBeneficiario('EMPLEADO');
                setSocio(null);
              }}
            >
              Empleado
            </BotonBeneficiario>
          </div>

          {beneficiario === 'SOCIO' && (
            <div className="flex gap-1.5">
              {SOCIOS.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setSocio(sc)}
                  className={`min-h-[42px] flex-1 cursor-pointer rounded-xl text-sm font-bold ${
                    socio === sc ? 'bg-primario text-white' : 'border border-borde-fuerte bg-white text-texto-suave'
                  }`}
                >
                  {sc.charAt(0) + sc.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          )}

          {beneficiario === 'SOCIO' && (
            <div className="rounded-xl bg-advertencia-suave px-3 py-2 text-[13px] font-semibold text-advertencia-texto">
              Retiro de mercadería: sale del stock y no se cobra. No es venta.
            </div>
          )}
          {beneficiario === 'EMPLEADO' && (
            <div className="rounded-xl bg-advertencia-suave px-3 py-2 text-[13px] font-semibold text-advertencia-texto">
              {descuentoEmpleadoPct > 0
                ? `Se aplica ${descuentoEmpleadoPct}% de descuento, redondeado para abajo.`
                : 'No hay descuento de empleado configurado — se cobra precio de lista.'}
            </div>
          )}
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
                    <span className="flex flex-col items-end text-[15px] font-extrabold">
                      {l.total !== null ? fmtMoneda(l.total) : 'sin precio'}
                      {l.lista !== null && l.total !== null && l.total !== l.lista && (
                        <span className="text-[13px] font-semibold text-texto-suave line-through">
                          {fmtMoneda(l.lista)}
                        </span>
                      )}
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
          {totalCarrito !== totalLista && (
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-texto-suave">Precio de lista</span>
              <span className="font-semibold text-texto-suave line-through">{fmtMoneda(totalLista)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-texto-suave">
              {beneficiario === 'SOCIO' ? 'Se lleva' : 'Total'}
            </span>
            <span className="text-[28px] font-extrabold">{fmtMoneda(totalCarrito)}</span>
          </div>
          {faltaSocio && (
            <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-[14px] font-semibold text-error-texto">
              Elegí qué socio se lleva la mercadería.
            </div>
          )}
          <button
            type="button"
            disabled={carrito.length === 0 || haySinPrecio || faltaSocio || mutConfirmar.isPending}
            onClick={() => {
              setError(null);
              mutConfirmar.mutate();
            }}
            className="min-h-[60px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutConfirmar.isPending
              ? 'CONFIRMANDO…'
              : beneficiario === 'SOCIO'
                ? 'REGISTRAR RETIRO'
                : 'CONFIRMAR PEDIDO'}
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

      {/* Retiro de socio: no hay cobro, solo se confirma y se cierra */}
      {retiroConfirmado && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">Retiro registrado ✓</div>
            <div className="text-base text-texto-suave">
              La mercadería salió del stock. No se cobra nada.
            </div>
            <button
              type="button"
              disabled={mutCerrarRetiro.isPending}
              onClick={() => mutCerrarRetiro.mutate(retiroConfirmado.id)}
              className="mt-1 min-h-[56px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white disabled:opacity-50"
            >
              {mutCerrarRetiro.isPending ? 'CERRANDO…' : 'LISTO'}
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
