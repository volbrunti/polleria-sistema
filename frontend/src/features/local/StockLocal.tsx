import { useQuery } from '@tanstack/react-query';
import { consultarStock } from '../../api/stock';
import { fmtNumero } from '../../lib/formato';

interface Props {
  sucursalId: number;
  sucursalNombre: string;
}

export function StockLocal({ sucursalId, sucursalNombre }: Props) {
  const stock = useQuery({ queryKey: ['stock', sucursalId], queryFn: () => consultarStock(sucursalId) });

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-6">
      <div className="text-2xl font-extrabold">Stock — {sucursalNombre}</div>
      <div className="overflow-hidden rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_140px_110px] bg-chip px-5 py-3 text-[13px] font-extrabold tracking-wide text-texto-suave">
          <span>PRODUCTO</span>
          <span className="text-right">CANTIDAD</span>
          <span className="text-right">UNIDAD</span>
        </div>
        {stock.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
        {stock.data?.map((r) => (
          <div key={r.productoId} className="grid grid-cols-[1fr_140px_110px] border-t border-[#eef1ea] px-5 py-4 text-[17px]">
            <span className="font-bold">{r.nombre}</span>
            <span className="text-right font-bold">{fmtNumero(r.cantidad)}</span>
            <span className="text-right text-texto-suave">{r.unidadDeMedida?.toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
