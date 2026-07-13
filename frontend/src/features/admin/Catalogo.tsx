import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listarProductos,
  crearProducto,
  actualizarProducto,
  historialPrecios,
  cambiarPrecio,
  crearCombo,
} from '../../api/productos';
import { listarProveedores, crearProveedor, actualizarProveedor } from '../../api/proveedores';
import { listarSucursales } from '../../api/sucursales';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtMoneda, fmtNumero } from '../../lib/formato';
import type { Producto, Proveedor, TipoProducto, UnidadDeMedida } from '../../api/types';

interface Props {
  puedeEscribir: boolean;
}

type Tab = 'productos' | 'combos' | 'precios' | 'proveedores' | 'sucursales';

const TABS: { id: Tab; label: string }[] = [
  { id: 'productos', label: 'Productos' },
  { id: 'combos', label: 'Combos' },
  { id: 'precios', label: 'Precios' },
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
  const [tipo, setTipo] = useState<TipoProducto>('MATERIA_PRIMA');
  const [unidad, setUnidad] = useState<UnidadDeMedida>('KG');
  const [error, setError] = useState<string | null>(null);

  function abrirNuevo() {
    setEditando(null);
    setNombre('');
    setCategoria('');
    setTipo('MATERIA_PRIMA');
    setUnidad('KG');
    setAbierto(true);
    setError(null);
  }

  function abrirEditar(p: Producto) {
    setEditando(p);
    setNombre(p.nombre);
    setCategoria(p.categoria);
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
    mutationFn: (vars: { id: number; nombre: string; categoria: string }) =>
      actualizarProducto(vars.id, { nombre: vars.nombre, categoria: vars.categoria }),
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
                if (editando) mutActualizar.mutate({ id: editando.id, nombre, categoria });
                else mutCrear.mutate({ nombre, categoria, tipo, unidadDeMedida: unidad });
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_160px_170px_110px_110px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>CATEGORÍA</span>
          <span>TIPO</span>
          <span>UNIDAD</span>
          <span />
        </div>
        {productos.data?.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_160px_170px_110px_110px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <span className="font-semibold">{p.nombre}</span>
            <span className="text-texto-suave">{p.categoria}</span>
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
  const [componentes, setComponentes] = useState<{ productoComponenteId: number; cantidad: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  function abrirNuevo() {
    setNombre('');
    setCategoria('');
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

  const historiales = useQueries({
    queries: (productos.data ?? []).map((p) => ({
      queryKey: ['precios', p.id],
      queryFn: () => historialPrecios(p.id),
      enabled: !!productos.data,
    })),
  });

  const [productoEditando, setProductoEditando] = useState<Producto | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);

  const mutCambiarPrecio = useMutation({
    mutationFn: (vars: { productoId: number; monto: number }) => cambiarPrecio(vars.productoId, vars.monto),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['precios', vars.productoId] });
      setProductoEditando(null);
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
          const historial = historiales[idx]?.data ?? [];
          const actual = historial[0];
          return (
            <div key={p.id} className="border-t border-[#eef1ea]">
              <div className="grid grid-cols-[1fr_150px_170px_150px] items-center px-5 py-3.5 text-sm">
                <span className="font-semibold">{p.nombre}</span>
                <span className="text-right font-extrabold">{actual ? fmtMoneda(actual.monto) : '—'}</span>
                <span className="text-texto-suave">{actual ? fmtFecha(actual.fechaDesde) : '—'}</span>
                <div className="flex justify-end gap-2">
                  {historial.length > 0 && (
                    <button type="button" onClick={() => setExpandido(expandido === p.id ? null : p.id)} className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3 text-[13px] font-bold text-texto-suave">
                      {expandido === p.id ? 'Ocultar' : 'Historial'}
                    </button>
                  )}
                  {puedeEscribir && (
                    <button type="button" onClick={() => setProductoEditando(p)} className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3 text-[13px] font-bold text-primario">
                      Cambiar precio
                    </button>
                  )}
                </div>
              </div>
              {expandido === p.id && (
                <div className="flex flex-col gap-1 bg-[#f8faf5] px-5 py-3 text-sm text-texto-suave">
                  {historial.map((h) => (
                    <div key={h.id}>
                      {fmtMoneda(h.monto)} — vigente desde {fmtFecha(h.fechaDesde)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {productoEditando && (
        <TecladoNumerico
          titulo="Nuevo precio"
          subtitulo={productoEditando.nombre}
          unidad="$"
          onCancelar={() => setProductoEditando(null)}
          onConfirmar={(monto) => mutCambiarPrecio.mutate({ productoId: productoEditando.id, monto })}
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
      actualizarProveedor(vars.id, { nombre: vars.nombre, contacto: vars.contacto || null }),
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
            setNombre('');
            setContacto('');
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
        <div className="grid grid-cols-[1fr_200px_110px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>TELÉFONO</span>
          <span />
        </div>
        {proveedores.data?.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_200px_110px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <span className="font-semibold">{p.esOtro ? 'OTRO' : p.nombre}</span>
            <span className="text-texto-suave">{p.contacto ?? '—'}</span>
            {puedeEscribir && !p.esOtro && (
              <button
                type="button"
                onClick={() => {
                  setEditando(p);
                  setNombre(p.nombre);
                  setContacto(p.contacto ?? '');
                  setAbierto(true);
                  setError(null);
                }}
                className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario"
              >
                Editar
              </button>
            )}
          </div>
        ))}
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
