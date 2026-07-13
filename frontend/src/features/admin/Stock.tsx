import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarSucursales } from '../../api/sucursales';
import { listarProductos } from '../../api/productos';
import { consultarStock, consultarMovimientos } from '../../api/stock';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';

export function Stock() {
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => listarProductos() });

  const [sucursalId, setSucursalId] = useState<number | null>(null);
  const [vista, setVista] = useState<'tabla' | 'movimientos'>('tabla');
  const [filtroProductoId, setFiltroProductoId] = useState<number | null>(null);
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const sucursalActiva = sucursalId ?? sucursales.data?.[0]?.id ?? null;

  const stock = useQuery({
    queryKey: ['stock', sucursalActiva],
    queryFn: () => consultarStock(sucursalActiva!),
    enabled: vista === 'tabla' && sucursalActiva != null,
  });

  const movimientos = useQuery({
    queryKey: ['stock', 'movimientos', filtroProductoId, filtroSucursalId, desde, hasta],
    queryFn: () =>
      consultarMovimientos({
        productoId: filtroProductoId ?? undefined,
        sucursalId: filtroSucursalId ?? undefined,
        desde: desde || undefined,
        hasta: hasta ? `${hasta}T23:59:59` : undefined,
      }),
    enabled: vista === 'movimientos',
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <h1 className="m-0 flex-1 text-2xl font-extrabold">Stock</h1>
        {vista === 'tabla' && (
          <div className="flex gap-1.5 rounded-xl bg-[#e6e9e2] p-1.5">
            {sucursales.data?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSucursalId(s.id)}
                className={`min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold ${
                  sucursalActiva === s.id ? 'bg-primario text-white' : 'text-texto-suave'
                }`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setVista(vista === 'tabla' ? 'movimientos' : 'tabla')}
          className="min-h-11 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-sm font-bold text-primario"
        >
          {vista === 'tabla' ? 'Ver movimientos' : 'Ver stock actual'}
        </button>
      </div>

      {vista === 'tabla' && (
        <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
          <div className="grid grid-cols-[1fr_160px_120px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
            <span>PRODUCTO</span>
            <span className="text-right">CANTIDAD</span>
            <span className="text-right">UNIDAD</span>
          </div>
          {stock.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
          {stock.data?.map((r) => (
            <div key={r.productoId} className="grid grid-cols-[1fr_160px_120px] border-t border-[#eef1ea] px-5 py-3.5 text-[15px]">
              <span className="font-semibold">{r.nombre}</span>
              <span className="text-right font-bold">{fmtNumero(r.cantidad)}</span>
              <span className="text-right text-texto-suave">{r.unidadDeMedida?.toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}

      {vista === 'movimientos' && (
        <>
          <div className="flex flex-wrap gap-2.5">
            <select
              value={filtroProductoId ?? ''}
              onChange={(e) => setFiltroProductoId(e.target.value ? Number(e.target.value) : null)}
              className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
            >
              <option value="">Todos los productos</option>
              {productos.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <select
              value={filtroSucursalId ?? ''}
              onChange={(e) => setFiltroSucursalId(e.target.value ? Number(e.target.value) : null)}
              className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
            <div className="grid min-w-[720px] grid-cols-[120px_180px_1fr_130px_110px_130px] gap-x-3 bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
              <span>FECHA</span>
              <span>TIPO</span>
              <span>PRODUCTO</span>
              <span>SUCURSAL</span>
              <span className="text-right">CANT.</span>
              <span>USUARIO</span>
            </div>
            {movimientos.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
            {movimientos.data?.map((m) => (
              <div key={m.id} className="grid min-w-[720px] grid-cols-[120px_180px_1fr_130px_110px_130px] gap-x-3 border-t border-[#eef1ea] px-5 py-3 text-sm">
                <span className="text-texto-suave">{fmtFechaHora(m.fechaHora)}</span>
                <span className="font-semibold">{m.tipo}</span>
                <span>{m.producto?.nombre}</span>
                <span className="text-texto-suave">{sucursales.data?.find((s) => s.id === m.sucursalId)?.nombre}</span>
                <span className="text-right font-bold">{fmtNumero(m.cantidad)}</span>
                <span className="text-texto-suave">{m.usuario?.username}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
