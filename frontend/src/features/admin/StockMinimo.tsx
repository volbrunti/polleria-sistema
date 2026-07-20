import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configurarStockMinimo, listarConfigStockMinimo } from '../../api/stockMinimo';
import { listarProductos } from '../../api/productos';
import { listarSucursales } from '../../api/sucursales';
import { fmtNumero } from '../../lib/formato';
import { ApiError } from '../../api/client';

interface Props {
  puedeEscribir: boolean;
}

// Config de stock mínimo por producto+sucursal (Flujo 6, adelantado en el
// módulo 2 para alimentar los avisos del POS). Escritura solo ADMIN.
export function StockMinimo({ puedeEscribir }: Props) {
  const queryClient = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [productoId, setProductoId] = useState<number | null>(null);
  const [sucursalId, setSucursalId] = useState<number | null>(null);
  const [minimo, setMinimo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const configsQ = useQuery({ queryKey: ['stock-minimo'], queryFn: () => listarConfigStockMinimo() });
  const productosQ = useQuery({ queryKey: ['productos'], queryFn: () => listarProductos({ activo: true }) });
  const sucursalesQ = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });

  const locales = sucursalesQ.data?.filter((s) => s.tipo === 'VENTA') ?? [];
  const vendibles = (productosQ.data ?? []).filter((p) => p.tipo !== 'COMBO');

  const mutGuardar = useMutation({
    mutationFn: (datos: { productoId: number; sucursalId: number; minimo: number; activa?: boolean }) =>
      configurarStockMinimo(datos),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-minimo'] });
      setCreando(false);
      setProductoId(null);
      setSucursalId(null);
      setMinimo('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold">Stock mínimo</h1>
          <div className="mt-1 text-sm text-texto-suave">
            Bajo el mínimo, el POS avisa en cada venta. En cero, la venta se bloquea sola.
          </div>
        </div>
        {puedeEscribir && (
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="min-h-11 cursor-pointer rounded-[10px] bg-primario px-4.5 text-sm font-extrabold text-white hover:bg-primario-hover"
          >
            + Configurar mínimo
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-error-suave px-3.5 py-3 text-sm font-semibold text-error-texto">{error}</div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid min-w-[640px] grid-cols-[1fr_180px_120px_120px] gap-x-3 bg-chip px-4.5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>PRODUCTO</span>
          <span>SUCURSAL</span>
          <span className="text-right">MÍNIMO</span>
          <span className="text-right">ESTADO</span>
        </div>
        {configsQ.isLoading && <div className="px-4.5 py-4 text-texto-suave">Cargando…</div>}
        {configsQ.data?.map((c) => (
          <div
            key={c.id}
            className="grid min-w-[640px] grid-cols-[1fr_180px_120px_120px] items-center gap-x-3 border-t border-[#eef1ea] px-4.5 py-3 text-sm"
          >
            <span className="font-semibold">{c.producto?.nombre}</span>
            <span className="text-texto-suave">{c.sucursal?.nombre}</span>
            <span className="text-right font-extrabold">{fmtNumero(c.minimo, 1)}</span>
            <span className="text-right">
              {puedeEscribir ? (
                <button
                  type="button"
                  onClick={() =>
                    mutGuardar.mutate({
                      productoId: c.productoId,
                      sucursalId: c.sucursalId,
                      minimo: Number(c.minimo),
                      activa: !c.activa,
                    })
                  }
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-extrabold ${
                    c.activa ? 'bg-[#e3f4e9] text-primario' : 'bg-chip text-texto-suave'
                  }`}
                >
                  {c.activa ? 'Activa' : 'Inactiva'}
                </button>
              ) : (
                <span className={`text-[13px] font-extrabold ${c.activa ? 'text-primario' : 'text-texto-suave'}`}>
                  {c.activa ? 'Activa' : 'Inactiva'}
                </span>
              )}
            </span>
          </div>
        ))}
        {configsQ.data?.length === 0 && (
          <div className="px-4.5 py-5 text-center text-texto-suave">Sin mínimos configurados todavía.</div>
        )}
      </div>

      {creando && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white p-5">
            <div className="text-xl font-extrabold">Configurar stock mínimo</div>
            <select
              value={productoId ?? ''}
              onChange={(e) => setProductoId(Number(e.target.value))}
              className="min-h-[48px] rounded-xl border-2 border-borde-fuerte bg-white px-3 text-sm font-semibold"
            >
              <option value="" disabled>
                Producto…
              </option>
              {vendibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <select
              value={sucursalId ?? ''}
              onChange={(e) => setSucursalId(Number(e.target.value))}
              className="min-h-[48px] rounded-xl border-2 border-borde-fuerte bg-white px-3 text-sm font-semibold"
            >
              <option value="" disabled>
                Sucursal…
              </option>
              {locales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.5"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              placeholder="Cantidad mínima"
              className="min-h-[48px] rounded-xl border-2 border-borde-fuerte px-4 text-base font-semibold"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setCreando(false)}
                className="min-h-[52px] flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-sm font-bold text-texto-suave"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={productoId == null || sucursalId == null || !minimo || Number(minimo) < 0 || mutGuardar.isPending}
                onClick={() => {
                  setError(null);
                  mutGuardar.mutate({ productoId: productoId!, sucursalId: sucursalId!, minimo: Number(minimo) });
                }}
                className="min-h-[52px] flex-[2] cursor-pointer rounded-2xl bg-primario text-base font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
              >
                {mutGuardar.isPending ? 'GUARDANDO…' : 'GUARDAR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
