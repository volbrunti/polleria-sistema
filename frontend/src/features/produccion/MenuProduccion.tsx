import { useQuery } from '@tanstack/react-query';
import { listarSucursales } from '../../api/sucursales';
import { bajoMinimo } from '../../api/stockMinimo';
import { fmtNumero } from '../../lib/formato';
import { ExploradorMateriaPrima } from './ExploradorMateriaPrima';
import type { LoteDeProduccion } from '../../api/types';

interface Props {
  loteAbierto: LoteDeProduccion | null | undefined;
  onIrIngreso: () => void;
  onIrProducir: () => void;
  onIrEnviar: () => void;
  onIrEnvios: () => void;
  onIrLote: (loteId: number) => void;
}

export function MenuProduccion({ loteAbierto, onIrIngreso, onIrProducir, onIrEnviar, onIrEnvios, onIrLote }: Props) {
  // Lo que está bajo el mínimo en el depósito de producción. Pablo lo quiere
  // como primer golpe de vista: "es como que lo primero que te choca es la
  // alerta".
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const sucursalProduccion = sucursales.data?.find((s) => s.tipo === 'PRODUCCION');
  const minimosQ = useQuery({
    queryKey: ['stock-minimo', 'bajo-minimo', sucursalProduccion?.id],
    queryFn: () => bajoMinimo(sucursalProduccion!.id),
    enabled: sucursalProduccion != null,
  });
  const bajoElMinimo = minimosQ.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-3.5 p-5">
      {bajoElMinimo.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-error bg-error-suave px-4 py-3.5">
          <span className="text-[13px] font-extrabold tracking-wide text-error-texto">
            STOCK BAJO EL MÍNIMO
          </span>
          {bajoElMinimo.map((a) => (
            <div key={a.productoId} className="flex justify-between gap-2.5 text-[15px] font-bold text-error-texto">
              <span className="min-w-0 truncate">{a.producto}</span>
              <span className="shrink-0">
                quedan {fmtNumero(a.stockRestante)} (mín. {fmtNumero(a.minimo)})
              </span>
            </div>
          ))}
        </div>
      )}
      {loteAbierto && (
        <button
          type="button"
          onClick={() => onIrLote(loteAbierto.id)}
          className="flex w-full cursor-pointer flex-col gap-0.5 rounded-2xl border-2 border-[#d8a800] bg-[#fff7d9] px-4 py-3.5 text-left hover:bg-[#fdf0be]"
        >
          <span className="text-[13px] font-extrabold tracking-wide text-advertencia-texto">LOTE ABIERTO</span>
          <span className="text-[17px] font-bold text-texto">
            {loteAbierto.productoElaborado} — tocá para cargar el resultado
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onIrIngreso}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">LLEGÓ MERCADERÍA</span>
        <span className="text-[15px] text-texto-suave">Registrar un ingreso del proveedor</span>
      </button>

      <button
        type="button"
        onClick={onIrProducir}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">PRODUCIR</span>
        <span className="text-[15px] text-texto-suave">Empezar un lote de producción</span>
      </button>

      <button
        type="button"
        onClick={onIrEnviar}
        className="flex min-h-24 w-full cursor-pointer flex-col gap-1 rounded-2xl border-2 border-borde bg-white px-5 py-4.5 text-left hover:border-primario"
      >
        <span className="text-[22px] font-extrabold">ENVIAR A LOCAL</span>
        <span className="text-[15px] text-texto-suave">Mandar mercadería a un local</span>
      </button>

      <div className="rounded-2xl border border-borde bg-white px-4 py-3.5">
        <ExploradorMateriaPrima titulo="MATERIA PRIMA DISPONIBLE" />
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onIrEnvios}
        className="min-h-14 w-full cursor-pointer rounded-xl bg-transparent text-base font-semibold text-primario hover:bg-chip"
      >
        Ver mis envíos ›
      </button>
    </div>
  );
}
