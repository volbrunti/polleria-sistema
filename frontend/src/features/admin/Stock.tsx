import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listarSucursales } from '../../api/sucursales';
import { listarProductos } from '../../api/productos';
import { consultarStock, consultarMovimientos, crearAjuste } from '../../api/stock';
import { productosProduciblesCon } from '../../api/produccion';
import { ApiError } from '../../api/client';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';
import { ErrorDeCarga } from '../../components/ui/ErrorDeCarga';
import type { StockRow } from '../../api/types';

interface Props {
  puedeEscribir: boolean;
}

export function Stock({ puedeEscribir }: Props) {
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => listarProductos() });

  const [sucursalId, setSucursalId] = useState<number | null>(null);
  const [vista, setVista] = useState<'tabla' | 'movimientos'>('tabla');
  const [filtroProductoId, setFiltroProductoId] = useState<number | null>(null);
  const [filtroSucursalId, setFiltroSucursalId] = useState<number | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [editando, setEditando] = useState<StockRow | null>(null);

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
          <div className="flex w-full gap-1.5 overflow-x-auto rounded-xl bg-[#e6e9e2] p-1.5 md:w-auto">
            {sucursales.data?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSucursalId(s.id)}
                className={`min-h-11 shrink-0 cursor-pointer rounded-lg px-4 text-sm font-bold ${
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
        <div className="tabla-cards overflow-x-auto rounded-2xl border border-borde bg-white">
          <div
            className={`tabla-encabezado grid ${puedeEscribir ? 'grid-cols-[1fr_160px_120px_100px]' : 'grid-cols-[1fr_160px_120px]'} bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave`}
          >
            <span>PRODUCTO</span>
            <span className="text-right">CANTIDAD</span>
            <span className="text-right">UNIDAD</span>
            {puedeEscribir && <span />}
          </div>
          {stock.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
          {stock.isError && <ErrorDeCarga onReintentar={() => void stock.refetch()} />}
          {stock.data?.map((r) => (
            <div
              key={r.productoId}
              className={`tabla-fila grid ${puedeEscribir ? 'grid-cols-[1fr_160px_120px_100px]' : 'grid-cols-[1fr_160px_120px]'} items-center border-t border-[#eef1ea] px-5 py-3.5 text-[15px]`}
            >
              <span className="font-semibold">{r.nombre}</span>
              <span data-col="CANTIDAD" className="text-right font-bold">{fmtNumero(r.cantidad)}</span>
              <span data-col="UNIDAD" className="text-right text-texto-suave">{r.unidadDeMedida?.toLowerCase()}</span>
              {puedeEscribir && (
                <span className="text-right">
                  <button
                    type="button"
                    onClick={() => setEditando(r)}
                    className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario"
                  >
                    Editar
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {editando && sucursalActiva != null && (
        <ModalAjusteStock
          fila={editando}
          sucursalId={sucursalActiva}
          onCerrar={() => setEditando(null)}
        />
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
          <div className="tabla-cards overflow-x-auto rounded-2xl border border-borde bg-white">
            <div className="tabla-encabezado grid min-w-[720px] grid-cols-[120px_180px_1fr_130px_110px_130px] gap-x-3 bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
              <span>FECHA</span>
              <span>TIPO</span>
              <span>PRODUCTO</span>
              <span>SUCURSAL</span>
              <span className="text-right">CANT.</span>
              <span>USUARIO</span>
            </div>
            {movimientos.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
            {movimientos.data?.map((m) => (
              <div key={m.id} className="tabla-fila grid min-w-[720px] grid-cols-[120px_180px_1fr_130px_110px_130px] gap-x-3 border-t border-[#eef1ea] px-5 py-3 text-sm">
                <span data-col="FECHA" className="text-texto-suave">{fmtFechaHora(m.fechaHora)}</span>
                <span className="font-semibold">{m.tipo}</span>
                <span data-col="PRODUCTO">{m.producto?.nombre}</span>
                <span data-col="SUCURSAL" className="text-texto-suave">{sucursales.data?.find((s) => s.id === m.sucursalId)?.nombre}</span>
                <span data-col="CANT." className="text-right font-bold">{fmtNumero(m.cantidad)}</span>
                <span data-col="USUARIO" className="text-texto-suave">{m.usuario?.username}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Corrección manual de stock: siempre editando y confirmando, nunca inline
// (pedido tras la prueba en vivo). Un solo paso — se muestra la cantidad
// actual (solo lectura), se pide la nueva y un motivo obligatorio, y recién
// ahí se confirma. Como el stock es SUM(MovimientoStock), un único ajuste
// queda reflejado en todas las pantallas sin nada más que "propagar".
function ModalAjusteStock({
  fila,
  sucursalId,
  onCerrar,
}: {
  fila: StockRow;
  sucursalId: number;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [cantidadNueva, setCantidadNueva] = useState(fila.cantidad);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Si este producto es insumo de alguna ficha técnica activa, mostrar en
  // qué se usa — así el admin ve de un vistazo si la unidad que está por
  // cargar (kg vs. unidad) tiene sentido con cómo lo consume producción.
  const producible = useQuery({
    queryKey: ['produccion', 'producible-con', fila.productoId],
    queryFn: () => productosProduciblesCon(fila.productoId),
  });

  const mut = useMutation({
    mutationFn: () =>
      crearAjuste({
        productoId: fila.productoId,
        sucursalId,
        cantidadNueva: Number(cantidadNueva),
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onCerrar();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar el ajuste.'),
  });

  const numeroValido = cantidadNueva.trim() !== '' && !Number.isNaN(Number(cantidadNueva)) && Number(cantidadNueva) >= 0;
  const puedeGuardar = numeroValido && motivo.trim().length > 0 && !mut.isPending;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div className="flex w-full flex-col gap-3 overflow-hidden rounded-t-3xl bg-white p-5 sm:max-w-md sm:rounded-3xl">
        <div className="text-lg font-extrabold">Editar stock — {fila.nombre}</div>

        <div className="flex items-center justify-between rounded-xl bg-chip px-3.5 py-3 text-sm">
          <span className="text-texto-suave">Cantidad actual</span>
          <span className="font-extrabold">
            {fmtNumero(fila.cantidad)} {fila.unidadDeMedida?.toLowerCase()}
          </span>
        </div>

        {!producible.isLoading && (producible.data?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-primario-suave px-3.5 py-2.5 text-[13px] text-texto-suave">
            Se usa como insumo en: {producible.data!.map((p) => p.nombre).join(', ')} — la unidad que cargues acá
            tiene que ser {fila.unidadDeMedida?.toLowerCase()}, como en esas recetas.
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm font-semibold text-texto-suave">
          Cantidad nueva ({fila.unidadDeMedida?.toLowerCase()})
          <input
            type="number"
            min="0"
            step="0.001"
            value={cantidadNueva}
            onChange={(e) => setCantidadNueva(e.target.value)}
            className="h-12 rounded-[10px] border border-borde-fuerte px-3 text-base font-bold text-texto"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-semibold text-texto-suave">
          Motivo (obligatorio)
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: conteo físico, producto vencido, corrección de carga…"
            className="h-12 rounded-[10px] border border-borde-fuerte px-3 text-base"
          />
        </label>

        {error && (
          <div className="rounded-xl bg-error-suave px-3.5 py-3 text-sm font-semibold text-error-texto">{error}</div>
        )}

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
            disabled={!puedeGuardar}
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            className="min-h-12 flex-[2] cursor-pointer rounded-xl bg-primario text-sm font-extrabold text-white disabled:opacity-50"
          >
            {mut.isPending ? 'GUARDANDO…' : 'CONFIRMAR AJUSTE'}
          </button>
        </div>
      </div>
    </div>
  );
}
