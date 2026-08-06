import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listarProductos,
  crearProducto,
  actualizarProducto,
  historialPrecios,
  cambiarPrecio,
  crearCombo,
  tablaPrecioVigente,
} from '../../api/productos';
import {
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
  productosHabituales,
  guardarProductosHabituales,
} from '../../api/proveedores';
import { listarSucursales } from '../../api/sucursales';
import { listarRecargos, crearRecargo, actualizarRecargo } from '../../api/recargos';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtMoneda, fmtNumero } from '../../lib/formato';
import type { Producto, Proveedor, TipoProducto, UnidadDeMedida } from '../../api/types';

// "Hace cuánto que no cambia" al lado de la fecha. Pablo: "ahí donde le ponen
// la fecha de la última vez que cambió, le haría una resta entre hoy y esa
// fecha — que te diga un mes, dos meses, 30 días, 40 días" (reunión 4/8).
function antiguedadPrecio(fechaDesde: string): string {
  const dias = Math.floor((Date.now() - new Date(fechaDesde).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'hace 1 día';
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;
}

interface Props {
  puedeEscribir: boolean;
}

type Tab = 'productos' | 'combos' | 'precios' | 'recargos' | 'proveedores' | 'sucursales';

const TABS: { id: Tab; label: string }[] = [
  { id: 'productos', label: 'Productos' },
  { id: 'combos', label: 'Combos' },
  { id: 'precios', label: 'Precios' },
  { id: 'recargos', label: 'Recargos de tarjeta' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'sucursales', label: 'Sucursales' },
];

export function Catalogo({ puedeEscribir }: Props) {
  const [tab, setTab] = useState<Tab>('productos');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <h1 className="m-0 flex-1 text-2xl font-extrabold">Catálogo</h1>
        <div className="flex gap-1.5 rounded-xl bg-[#e6e9e2] p-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold ${
                tab === t.id ? 'bg-primario text-white' : 'text-texto-suave'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'productos' && <TabProductos puedeEscribir={puedeEscribir} />}
      {tab === 'combos' && <TabCombos puedeEscribir={puedeEscribir} />}
      {tab === 'precios' && <TabPrecios puedeEscribir={puedeEscribir} />}
      {tab === 'recargos' && <TabRecargos puedeEscribir={puedeEscribir} />}
      {tab === 'proveedores' && <TabProveedores puedeEscribir={puedeEscribir} />}
      {tab === 'sucursales' && <TabSucursales />}
    </div>
  );
}

function TabProductos({ puedeEscribir }: { puedeEscribir: boolean }) {
  const queryClient = useQueryClient();
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => listarProductos() });
  const [editando, setEditando] = useState<Producto | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [categoriaMadre, setCategoriaMadre] = useState('');
  const [tipo, setTipo] = useState<TipoProducto>('MATERIA_PRIMA');
  const [unidad, setUnidad] = useState<UnidadDeMedida>('KG');
  const [error, setError] = useState<string | null>(null);

  const [fBusqueda, setFBusqueda] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fTipo, setFTipo] = useState<TipoProducto | ''>('');
  const [fActivo, setFActivo] = useState<'todos' | 'activos' | 'inactivos'>('activos');

  const categoriasDisponibles = [...new Set((productos.data ?? []).map((p) => p.categoria))].sort();
  // Agrupadores ya en uso: el admin elige de la lista en vez de tipearlos y
  // que dos productos queden en "Pollos" y "pollos" por una mayúscula.
  const madresDisponibles = [
    ...new Set((productos.data ?? []).map((p) => p.categoriaMadre).filter((m): m is string => !!m)),
  ].sort();

  const productosFiltrados = (productos.data ?? []).filter((p) => {
    if (fBusqueda.trim() && !p.nombre.toLowerCase().includes(fBusqueda.trim().toLowerCase())) return false;
    if (fCategoria && p.categoria !== fCategoria) return false;
    if (fTipo && p.tipo !== fTipo) return false;
    if (fActivo === 'activos' && !p.activo) return false;
    if (fActivo === 'inactivos' && p.activo) return false;
    return true;
  });

  function abrirNuevo() {
    setEditando(null);
    setNombre('');
    setCategoria('');
    setCategoriaMadre('');
    setTipo('MATERIA_PRIMA');
    setUnidad('KG');
    setAbierto(true);
    setError(null);
  }

  function abrirEditar(p: Producto) {
    setEditando(p);
    setNombre(p.nombre);
    setCategoria(p.categoria);
    setCategoriaMadre(p.categoriaMadre ?? '');
    setAbierto(true);
    setError(null);
  }

  const mutCrear = useMutation({
    mutationFn: crearProducto,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['productos'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el producto.'),
  });

  const mutActualizar = useMutation({
    mutationFn: (vars: { id: number; nombre: string; categoria: string; categoriaMadre?: string }) =>
      actualizarProducto(vars.id, {
        nombre: vars.nombre,
        categoria: vars.categoria,
        categoriaMadre: vars.categoriaMadre,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['productos'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el producto.'),
  });

  return (
    <div className="flex flex-col gap-3.5">
      {puedeEscribir && !abierto && (
        <button
          type="button"
          onClick={abrirNuevo}
          className="w-fit min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
        >
          ＋ NUEVO PRODUCTO
        </button>
      )}
      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-primario bg-white p-4.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Categoría" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            {/* Agrupador del POS: con qué otras categorías comparte botón en la caja */}
            <input
              value={categoriaMadre}
              onChange={(e) => setCategoriaMadre(e.target.value)}
              list="madres-catalogo"
              placeholder="Grupo en el POS (ej: Pollos)"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
            <datalist id="madres-catalogo">
              {madresDisponibles.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {!editando && (
              <>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoProducto)} className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm">
                  <option value="MATERIA_PRIMA">Materia prima</option>
                  <option value="ELABORADO">Elaborado</option>
                  <option value="REVENTA">Reventa</option>
                </select>
                <select value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadDeMedida)} className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm">
                  <option value="KG">Kg</option>
                  <option value="UNIDAD">Unidad</option>
                </select>
              </>
            )}
          </div>
          {error && <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-sm font-semibold text-error-texto">{error}</div>}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setAbierto(false)} className="min-h-11.5 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nombre.trim() || !categoria.trim() || mutCrear.isPending || mutActualizar.isPending}
              onClick={() => {
                setError(null);
                const madre = categoriaMadre.trim() || undefined;
                if (editando) mutActualizar.mutate({ id: editando.id, nombre, categoria, categoriaMadre: madre });
                else mutCrear.mutate({ nombre, categoria, categoriaMadre: madre, tipo, unidadDeMedida: unidad });
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-borde bg-white p-3.5">
        <input
          value={fBusqueda}
          onChange={(e) => setFBusqueda(e.target.value)}
          placeholder="Buscar por nombre…"
          className="h-11 min-w-[180px] flex-1 rounded-[10px] border border-borde-fuerte px-3 text-sm"
        />
        <select
          value={fCategoria}
          onChange={(e) => setFCategoria(e.target.value)}
          className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
        >
          <option value="">Todas las categorías</option>
          {categoriasDisponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={fTipo}
          onChange={(e) => setFTipo(e.target.value as TipoProducto | '')}
          className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
        >
          <option value="">Todos los tipos</option>
          <option value="MATERIA_PRIMA">Materia prima</option>
          <option value="ELABORADO">Elaborado</option>
          <option value="REVENTA">Reventa</option>
          <option value="COMBO">Combo</option>
        </select>
        <select
          value={fActivo}
          onChange={(e) => setFActivo(e.target.value as 'todos' | 'activos' | 'inactivos')}
          className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
        >
          <option value="activos">Solo activos</option>
          <option value="inactivos">Solo inactivos</option>
          <option value="todos">Todos</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_150px_140px_150px_100px_110px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>CATEGORÍA</span>
          <span>GRUPO EN EL POS</span>
          <span>TIPO</span>
          <span>UNIDAD</span>
          <span />
        </div>
        {productosFiltrados.length === 0 && (
          <div className="px-5 py-6 text-center text-sm text-texto-suave">Sin resultados con estos filtros.</div>
        )}
        {productosFiltrados.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_150px_140px_150px_100px_110px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <span className={`font-semibold ${p.activo ? '' : 'text-texto-suave line-through'}`}>{p.nombre}</span>
            <span className="text-texto-suave">{p.categoria}</span>
            <span className="text-texto-suave">
              {p.tipo === 'MATERIA_PRIMA' ? '—' : (p.categoriaMadre ?? 'Otros')}
            </span>
            <span className="font-mono text-xs text-texto-suave">{p.tipo}</span>
            <span className="text-texto-suave">{p.unidadDeMedida}</span>
            {puedeEscribir && (
              <button type="button" onClick={() => abrirEditar(p)} className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario">
                Editar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabCombos({ puedeEscribir }: { puedeEscribir: boolean }) {
  const queryClient = useQueryClient();
  const combos = useQuery({ queryKey: ['productos', 'combos'], queryFn: () => listarProductos({ tipo: 'COMBO' }) });
  const productosBase = useQuery({
    queryKey: ['productos', 'no-combo'],
    queryFn: () => listarProductos(),
    select: (data) => data.filter((p) => p.tipo !== 'COMBO'),
  });

  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [categoriaMadre, setCategoriaMadre] = useState('');
  const [componentes, setComponentes] = useState<{ productoComponenteId: number; cantidad: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  function abrirNuevo() {
    setNombre('');
    setCategoria('');
    setCategoriaMadre('');
    setComponentes([]);
    setAbierto(true);
    setError(null);
  }

  function agregarComponente() {
    const primero = productosBase.data?.[0];
    if (!primero) return;
    setComponentes((c) => [...c, { productoComponenteId: primero.id, cantidad: '1' }]);
  }

  const mutCrear = useMutation({
    mutationFn: crearCombo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['productos'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el combo.'),
  });

  const componentesValidos =
    componentes.length > 0 && componentes.every((c) => Number(c.cantidad) > 0);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="w-fit rounded-xl bg-[#fff7d9] px-3.5 py-3 text-sm font-semibold text-advertencia-texto">
        El precio del combo es un dato propio, no un descuento calculado — se carga desde la pestaña Precios una vez creado.
      </div>
      {puedeEscribir && !abierto && (
        <button
          type="button"
          onClick={abrirNuevo}
          className="w-fit min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
        >
          ＋ NUEVO COMBO
        </button>
      )}
      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-primario bg-white p-4.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre del combo"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
            <input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Categoría"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
            <input
              value={categoriaMadre}
              onChange={(e) => setCategoriaMadre(e.target.value)}
              placeholder="Grupo en el POS (ej: Pollos)"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-bold text-texto-suave">Componentes</div>
            {componentes.map((c, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_110px_44px] gap-2">
                <select
                  value={c.productoComponenteId}
                  onChange={(e) =>
                    setComponentes((arr) =>
                      arr.map((x, i) => (i === idx ? { ...x, productoComponenteId: Number(e.target.value) } : x)),
                    )
                  }
                  className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
                >
                  {productosBase.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={c.cantidad}
                  onChange={(e) =>
                    setComponentes((arr) => arr.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)))
                  }
                  className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setComponentes((arr) => arr.filter((_, i) => i !== idx))}
                  aria-label="Quitar componente"
                  className="min-h-11.5 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-error-texto"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={agregarComponente}
              disabled={!productosBase.data?.length}
              className="w-fit min-h-10 cursor-pointer rounded-lg border-2 border-dashed border-borde-fuerte bg-transparent px-3 text-sm font-bold text-primario disabled:opacity-50"
            >
              ＋ Agregar componente
            </button>
          </div>
          {error && <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-sm font-semibold text-error-texto">{error}</div>}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="min-h-11.5 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nombre.trim() || !categoria.trim() || !componentesValidos || mutCrear.isPending}
              onClick={() => {
                setError(null);
                mutCrear.mutate({
                  nombre,
                  categoria,
                  categoriaMadre: categoriaMadre.trim() || undefined,
                  componentes: componentes.map((c) => ({
                    productoComponenteId: c.productoComponenteId,
                    cantidad: Number(c.cantidad),
                  })),
                });
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_1fr] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>COMBO</span>
          <span>COMPONENTES</span>
        </div>
        {combos.data?.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_1fr] items-start border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <div>
              <div className="font-semibold">{c.nombre}</div>
              <div className="text-texto-suave">{c.categoria}</div>
            </div>
            <div className="flex flex-col gap-1">
              {(c.componentesDelCombo ?? []).map((comp) => (
                <span key={comp.id} className="text-texto-suave">
                  {comp.productoComponente?.nombre} × {fmtNumero(comp.cantidad)}
                </span>
              ))}
            </div>
          </div>
        ))}
        {combos.data?.length === 0 && (
          <div className="px-5 py-6 text-sm text-texto-suave">Todavía no hay combos cargados.</div>
        )}
      </div>
    </div>
  );
}

function TabPrecios({ puedeEscribir }: { puedeEscribir: boolean }) {
  const queryClient = useQueryClient();
  const productos = useQuery({
    queryKey: ['productos', 'vendibles'],
    queryFn: () => listarProductos(),
    select: (data) => data.filter((p) => p.tipo !== 'MATERIA_PRIMA'),
  });

  // Precio vigente por cantidad: para un producto normal siempre 1 fila
  // (cantidad=1); para un COMBO, la tabla completa de precio por volumen.
  const tablas = useQueries({
    queries: (productos.data ?? []).map((p) => ({
      queryKey: ['precios-vigente', p.id],
      queryFn: () => tablaPrecioVigente(p.id),
      enabled: !!productos.data,
    })),
  });

  // Historial completo (todas las cantidades mezcladas) — solo se usa para
  // productos NO combo, donde nunca hay más de una cantidad en juego.
  const historiales = useQueries({
    queries: (productos.data ?? []).map((p) => ({
      queryKey: ['precios', p.id],
      queryFn: () => historialPrecios(p.id),
      enabled: !!productos.data,
    })),
  });

  const [productoEditando, setProductoEditando] = useState<{ producto: Producto; cantidad: number } | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [nuevaCantidad, setNuevaCantidad] = useState<Record<number, string>>({});

  const mutCambiarPrecio = useMutation({
    mutationFn: (vars: { productoId: number; monto: number; cantidad: number }) =>
      cambiarPrecio(vars.productoId, vars.monto, vars.cantidad),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['precios-vigente', vars.productoId] });
      void queryClient.invalidateQueries({ queryKey: ['precios', vars.productoId] });
      setProductoEditando(null);
      setNuevaCantidad((m) => ({ ...m, [vars.productoId]: '' }));
    },
  });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="w-fit rounded-xl bg-[#fff7d9] px-3.5 py-3 text-sm font-semibold text-advertencia-texto">
        Cambiar un precio crea un registro nuevo — el historial se conserva siempre.
      </div>
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_150px_170px_150px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>PRODUCTO</span>
          <span className="text-right">PRECIO ACTUAL</span>
          <span>VIGENTE DESDE</span>
          <span />
        </div>
        {(productos.data ?? []).map((p, idx) => {
          const tabla = tablas[idx]?.data ?? [];
          const historial = historiales[idx]?.data ?? [];
          const esCombo = p.tipo === 'COMBO';
          const base = tabla.find((t) => t.cantidad === 1) ?? tabla[0];
          return (
            <div key={p.id} className="border-t border-[#eef1ea]">
              <div className="grid grid-cols-[1fr_150px_170px_150px] items-center px-5 py-3.5 text-sm">
                <span className="font-semibold">{p.nombre}</span>
                <span className="text-right font-extrabold">
                  {base ? fmtMoneda(base.monto) : '—'}
                  {esCombo && tabla.length > 1 && (
                    <span className="ml-1.5 font-normal text-texto-suave">(×1)</span>
                  )}
                </span>
                <span className="text-texto-suave">
                  {base ? (
                    <>
                      {fmtFecha(base.fechaDesde)}
                      <span className="ml-1.5 text-[13px] font-semibold">({antiguedadPrecio(base.fechaDesde)})</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <div className="flex justify-end gap-2">
                  {(historial.length > 0 || esCombo) && (
                    <button
                      type="button"
                      onClick={() => setExpandido(expandido === p.id ? null : p.id)}
                      className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3 text-[13px] font-bold text-texto-suave"
                    >
                      {expandido === p.id ? 'Ocultar' : esCombo ? 'Precios por cantidad' : 'Historial'}
                    </button>
                  )}
                  {puedeEscribir && !esCombo && (
                    <button
                      type="button"
                      onClick={() => setProductoEditando({ producto: p, cantidad: 1 })}
                      className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3 text-[13px] font-bold text-primario"
                    >
                      Cambiar precio
                    </button>
                  )}
                </div>
              </div>

              {expandido === p.id && !esCombo && (
                <div className="flex flex-col gap-1 bg-[#f8faf5] px-5 py-3 text-sm text-texto-suave">
                  {historial.map((h) => (
                    <div key={h.id}>
                      {fmtMoneda(h.monto)} — vigente desde {fmtFecha(h.fechaDesde)}
                    </div>
                  ))}
                </div>
              )}

              {expandido === p.id && esCombo && (
                <div className="flex flex-col gap-2 bg-[#f8faf5] px-5 py-3.5 text-sm">
                  <div className="text-xs font-bold tracking-wide text-texto-suave">
                    CANTIDAD → PRECIO (no es cantidad × precio unitario, cada cantidad tiene su propio monto)
                  </div>
                  {tabla.length === 0 && <div className="text-texto-suave">Todavía no hay precios cargados.</div>}
                  {tabla.map((t) => (
                    <div key={t.cantidad} className="flex items-center gap-3 rounded-lg bg-white px-3.5 py-2.5">
                      <span className="font-mono font-bold text-texto-suave">× {t.cantidad}</span>
                      <span className="flex-1 text-right font-extrabold">{fmtMoneda(t.monto)}</span>
                      {puedeEscribir && (
                        <button
                          type="button"
                          onClick={() => setProductoEditando({ producto: p, cantidad: t.cantidad })}
                          className="min-h-8 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3 text-[12px] font-bold text-primario"
                        >
                          Cambiar
                        </button>
                      )}
                    </div>
                  ))}
                  {puedeEscribir && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="number"
                        min="1"
                        placeholder="Cantidad nueva"
                        value={nuevaCantidad[p.id] ?? ''}
                        onChange={(e) => setNuevaCantidad((m) => ({ ...m, [p.id]: e.target.value }))}
                        className="h-10 w-36 rounded-lg border border-borde-fuerte px-2.5 text-sm"
                      />
                      <button
                        type="button"
                        disabled={!Number(nuevaCantidad[p.id])}
                        onClick={() =>
                          setProductoEditando({ producto: p, cantidad: Number(nuevaCantidad[p.id]) })
                        }
                        className="min-h-10 cursor-pointer rounded-lg border-2 border-dashed border-borde-fuerte bg-transparent px-3 text-[13px] font-bold text-primario disabled:opacity-50"
                      >
                        ＋ Agregar precio para esa cantidad
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {productoEditando && (
        <TecladoNumerico
          titulo={productoEditando.cantidad === 1 ? 'Nuevo precio' : `Precio para ${productoEditando.cantidad} unidades`}
          subtitulo={productoEditando.producto.nombre}
          unidad="$"
          onCancelar={() => setProductoEditando(null)}
          onConfirmar={(monto) =>
            mutCambiarPrecio.mutate({
              productoId: productoEditando.producto.id,
              monto,
              cantidad: productoEditando.cantidad,
            })
          }
        />
      )}
    </div>
  );
}

function TabProveedores({ puedeEscribir }: { puedeEscribir: boolean }) {
  const queryClient = useQueryClient();
  const proveedores = useQuery({ queryKey: ['proveedores'], queryFn: listarProveedores });
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editandoHabituales, setEditandoHabituales] = useState<Proveedor | null>(null);

  // Datos de contacto (reunión 4/8). El punto de contacto es el que más pesa:
  // "si se lo pide Franco capaz no le dan bola, pero si lo llama Ariel sí".
  const [direccion, setDireccion] = useState('');
  const [urlMaps, setUrlMaps] = useState('');
  const [telefono, setTelefono] = useState('');
  const [personaContacto, setPersonaContacto] = useState('');
  const [horarios, setHorarios] = useState('');

  function limpiarFormulario() {
    setNombre('');
    setContacto('');
    setDireccion('');
    setUrlMaps('');
    setTelefono('');
    setPersonaContacto('');
    setHorarios('');
  }

  function cargarFormulario(p: Proveedor) {
    setNombre(p.nombre);
    setContacto(p.contacto ?? '');
    setDireccion(p.direccion ?? '');
    setUrlMaps(p.urlMaps ?? '');
    setTelefono(p.telefono ?? '');
    setPersonaContacto(p.personaContacto ?? '');
    setHorarios(p.horarios ?? '');
  }

  const camposContacto = () => ({
    direccion: direccion.trim() || null,
    urlMaps: urlMaps.trim() || null,
    telefono: telefono.trim() || null,
    personaContacto: personaContacto.trim() || null,
    horarios: horarios.trim() || null,
  });

  const mutCrear = useMutation({
    mutationFn: crearProveedor,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el proveedor.'),
  });

  const mutActualizar = useMutation({
    mutationFn: (vars: { id: number; nombre: string; contacto: string }) =>
      actualizarProveedor(vars.id, {
        nombre: vars.nombre,
        contacto: vars.contacto || null,
        ...camposContacto(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el proveedor.'),
  });

  return (
    <div className="flex flex-col gap-3.5">
      {puedeEscribir && !abierto && (
        <button
          type="button"
          onClick={() => {
            setEditando(null);
            limpiarFormulario();
            setAbierto(true);
            setError(null);
          }}
          className="w-fit min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
        >
          ＋ NUEVO PROVEEDOR
        </button>
      )}
      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-primario bg-white p-4.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Teléfono / contacto" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
          </div>
          <div className="text-[13px] font-bold text-texto-suave">Datos para ir a buscar o llamar</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input value={personaContacto} onChange={(e) => setPersonaContacto(e.target.value)} placeholder="Con quién hablar" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono directo" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={urlMaps} onChange={(e) => setUrlMaps(e.target.value)} placeholder="Link de Google Maps" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input value={horarios} onChange={(e) => setHorarios(e.target.value)} placeholder="Horarios de atención" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
          </div>
          {error && <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-sm font-semibold text-error-texto">{error}</div>}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setAbierto(false)} className="min-h-11.5 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nombre.trim() || mutCrear.isPending || mutActualizar.isPending}
              onClick={() => {
                setError(null);
                if (editando) mutActualizar.mutate({ id: editando.id, nombre, contacto });
                else mutCrear.mutate({ nombre, contacto: contacto || undefined });
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_260px_110px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>CONTACTO</span>
          <span />
        </div>
        {proveedores.data?.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_260px_110px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <span className="font-semibold">{p.esOtro ? 'OTRO' : p.nombre}</span>
            <div className="flex flex-col gap-0.5 text-texto-suave">
              <span>
                {p.personaContacto ? `${p.personaContacto} · ` : ''}
                {p.telefono ?? p.contacto ?? '—'}
              </span>
              {p.direccion && (
                <span className="text-[13px]">
                  {p.urlMaps ? (
                    <a href={p.urlMaps} target="_blank" rel="noreferrer" className="text-primario underline">
                      {p.direccion}
                    </a>
                  ) : (
                    p.direccion
                  )}
                </span>
              )}
              {p.horarios && <span className="text-[13px]">{p.horarios}</span>}
            </div>
            {puedeEscribir && !p.esOtro && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditandoHabituales(p)}
                  className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario"
                >
                  Habituales
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditando(p);
                    cargarFormulario(p);
                    setAbierto(true);
                    setError(null);
                  }}
                  className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario"
                >
                  Editar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editandoHabituales && (
        <ModalProductosHabituales proveedor={editandoHabituales} onCerrar={() => setEditandoHabituales(null)} />
      )}
    </div>
  );
}

// Configuración fija de qué productos suele traer cada proveedor (sin
// cantidades) — el admin la carga una vez y sirve de acceso rápido en el
// asistente de "Llegó mercadería" del rol PRODUCCION.
function ModalProductosHabituales({ proveedor, onCerrar }: { proveedor: Proveedor; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const materiasPrimas = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA', 'activo'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA', activo: true }),
  });
  const habituales = useQuery({
    queryKey: ['proveedores', proveedor.id, 'productos-habituales'],
    queryFn: () => productosHabituales(proveedor.id),
  });
  const [seleccion, setSeleccion] = useState<Set<number> | null>(null);
  const [busqueda, setBusqueda] = useState('');

  if (seleccion === null && habituales.data) {
    setSeleccion(new Set(habituales.data.map((p) => p.id)));
  }

  const mutGuardar = useMutation({
    mutationFn: () => guardarProductosHabituales(proveedor.id, [...(seleccion ?? [])]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proveedores', proveedor.id, 'productos-habituales'] });
      onCerrar();
    },
  });

  const filtrados = (materiasPrimas.data ?? []).filter((p) =>
    busqueda.trim() ? p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) : true,
  );

  function alternar(id: number) {
    setSeleccion((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div className="flex max-h-[85%] w-full flex-col gap-3 overflow-hidden rounded-t-3xl bg-white p-5 sm:max-w-md sm:rounded-3xl">
        <div className="text-lg font-extrabold">Productos habituales — {proveedor.nombre}</div>
        <div className="text-sm text-texto-suave">
          Marcá qué productos suele traer este proveedor. Van a aparecer como acceso rápido al cargar un ingreso, sin
          cantidades — eso se sigue cargando en el momento.
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar…"
          className="h-11 w-full rounded-[10px] border border-borde-fuerte px-3 text-sm"
        />
        <div className="flex flex-col gap-1.5 overflow-auto">
          {filtrados.map((p) => (
            <label
              key={p.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-borde px-3.5 py-2 hover:bg-chip"
            >
              <input
                type="checkbox"
                checked={seleccion?.has(p.id) ?? false}
                onChange={() => alternar(p.id)}
                className="h-5 w-5"
              />
              <span className="text-sm font-semibold">{p.nombre}</span>
            </label>
          ))}
          {filtrados.length === 0 && <div className="py-4 text-center text-sm text-texto-suave">Sin resultados.</div>}
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-12 flex-1 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white text-sm font-bold text-texto-suave"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={mutGuardar.isPending || seleccion === null}
            onClick={() => mutGuardar.mutate()}
            className="min-h-12 flex-[2] cursor-pointer rounded-xl bg-primario text-sm font-extrabold text-white disabled:opacity-50"
          >
            {mutGuardar.isPending ? 'GUARDANDO…' : 'GUARDAR'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabSucursales() {
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  return (
    <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
      <div className="grid grid-cols-[1fr_1fr_160px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
        <span>SUCURSAL</span>
        <span>DIRECCIÓN</span>
        <span>TIPO</span>
      </div>
      {sucursales.data?.map((s) => (
        <div key={s.id} className="grid grid-cols-[1fr_1fr_160px] border-t border-[#eef1ea] px-5 py-3.5 text-sm">
          <span className="font-semibold">{s.nombre}</span>
          <span className="text-texto-suave">{s.direccion ?? '—'}</span>
          <span className="font-mono text-xs text-texto-suave">{s.tipo}</span>
        </div>
      ))}
    </div>
  );
}

// Recargos de tarjeta (reunión 4/8): la lista de porcentajes que el cajero ve
// desplegada al cobrar con débito o crédito. Se desactivan en vez de
// borrarse — los pagos viejos guardan su propio porcentaje, así que el
// histórico no se toca.
function TabRecargos({ puedeEscribir }: { puedeEscribir: boolean }) {
  const queryClient = useQueryClient();
  const recargos = useQuery({ queryKey: ['recargos-tarjeta', 'todos'], queryFn: () => listarRecargos() });

  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [medio, setMedio] = useState<'DEBITO' | 'CREDITO'>('CREDITO');
  const [porcentaje, setPorcentaje] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ['recargos-tarjeta'] });
  };

  const mutCrear = useMutation({
    mutationFn: crearRecargo,
    onSuccess: () => {
      invalidar();
      setAbierto(false);
      setNombre('');
      setPorcentaje('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el recargo.'),
  });

  const mutActivo = useMutation({
    mutationFn: (vars: { id: number; activo: boolean }) => actualizarRecargo(vars.id, { activo: vars.activo }),
    onSuccess: invalidar,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo actualizar.'),
  });

  const pctValido = Number(porcentaje) > 0 && Number(porcentaje) <= 100;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="w-fit rounded-xl bg-[#fff7d9] px-3.5 py-3 text-sm font-semibold text-advertencia-texto">
        Lo que cargues acá es lo que el cajero ve al cobrar con tarjeta. El recargo se suma al total
        del pedido y queda desglosado en el turno y en los reportes.
      </div>

      {puedeEscribir && !abierto && (
        <button
          type="button"
          onClick={() => {
            setAbierto(true);
            setError(null);
          }}
          className="w-fit min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
        >
          ＋ NUEVO RECARGO
        </button>
      )}

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-primario bg-white p-4.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre (ej: Visa 3 cuotas)"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
            <select
              value={medio}
              onChange={(e) => setMedio(e.target.value as 'DEBITO' | 'CREDITO')}
              className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
            >
              <option value="CREDITO">Crédito</option>
              <option value="DEBITO">Débito</option>
            </select>
            <input
              value={porcentaje}
              onChange={(e) => setPorcentaje(e.target.value)}
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="% de recargo"
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
          </div>
          {error && (
            <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-sm font-semibold text-error-texto">
              {error}
            </div>
          )}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="min-h-11.5 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nombre.trim() || !pctValido || mutCrear.isPending}
              onClick={() => {
                setError(null);
                mutCrear.mutate({ nombre: nombre.trim(), medio, porcentaje: Number(porcentaje) });
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_140px_120px_120px_130px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>MEDIO</span>
          <span className="text-right">RECARGO</span>
          <span>ESTADO</span>
          <span />
        </div>
        {recargos.isLoading && <div className="px-5 py-4 text-sm text-texto-suave">Cargando…</div>}
        {recargos.data?.length === 0 && (
          <div className="px-5 py-6 text-center text-sm text-texto-suave">
            Todavía no hay recargos cargados — el cajero solo va a poder cobrar sin adicional.
          </div>
        )}
        {recargos.data?.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1fr_140px_120px_120px_130px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm"
          >
            <span className={`font-semibold ${r.activo ? '' : 'text-texto-suave line-through'}`}>{r.nombre}</span>
            <span className="text-texto-suave">{r.medio === 'CREDITO' ? 'Crédito' : 'Débito'}</span>
            <span className="text-right font-extrabold">+{Number(r.porcentaje)}%</span>
            <span className={`text-[13px] font-bold ${r.activo ? 'text-primario' : 'text-texto-suave'}`}>
              {r.activo ? 'Activo' : 'Inactivo'}
            </span>
            {puedeEscribir && (
              <button
                type="button"
                disabled={mutActivo.isPending}
                onClick={() => mutActivo.mutate({ id: r.id, activo: !r.activo })}
                className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario disabled:opacity-50"
              >
                {r.activo ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
