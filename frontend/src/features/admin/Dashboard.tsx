import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { obtenerDashboard } from '../../api/dashboard';
import { listarSucursales } from '../../api/sucursales';
import { fmtMoneda, fmtNumero } from '../../lib/formato';

const LABEL_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  MERCADO_PAGO: 'Mercado Pago',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferencia',
};

function hoyISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function hace7DiasISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function Dashboard() {
  const [desde, setDesde] = useState(hace7DiasISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [sucursalId, setSucursalId] = useState<number | undefined>();

  const sucursalesQ = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const locales = sucursalesQ.data?.filter((s) => s.tipo === 'VENTA') ?? [];

  const dashQ = useQuery({
    queryKey: ['dashboard', desde, hasta, sucursalId],
    queryFn: () =>
      obtenerDashboard({
        desde: desde ? `${desde}T00:00:00` : undefined,
        hasta: hasta ? `${hasta}T23:59:59` : undefined,
        sucursalId,
      }),
  });

  const d = dashQ.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold">Dashboard</h1>
          <div className="mt-1 text-sm text-texto-suave">Resumen financiero y operativo</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="min-h-10 rounded-lg border border-borde-fuerte bg-white px-2.5 text-sm"
          />
          <span className="text-sm text-texto-suave">a</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="min-h-10 rounded-lg border border-borde-fuerte bg-white px-2.5 text-sm"
          />
          <select
            value={sucursalId ?? ''}
            onChange={(e) => setSucursalId(e.target.value ? Number(e.target.value) : undefined)}
            className="min-h-10 rounded-lg border border-borde-fuerte bg-white px-2.5 text-sm font-semibold"
          >
            <option value="">Todas</option>
            {locales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dashQ.isLoading && <p className="text-sm text-texto-suave">Cargando...</p>}
      {dashQ.error && (
        <p className="text-sm text-error">Error al cargar el dashboard.</p>
      )}

      {d && (
        <>
          {/* KPIs principales */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard titulo="Ventas totales" valor={fmtMoneda(d.totalVentas)} />
            <KpiCard titulo="Pedidos" valor={String(d.cantidadPedidos)} />
            <KpiCard titulo="Ticket promedio" valor={fmtMoneda(d.ticketPromedio)} />
            <KpiCard
              titulo="Alertas pendientes"
              valor={String(d.alertasPendientes)}
              alerta={d.alertasPendientes > 0}
            />
          </div>

          {/* Segunda fila */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard titulo="Gastos" valor={fmtMoneda(d.totalGastos)} />
            <KpiCard titulo="Retiros" valor={fmtMoneda(d.totalRetiros)} />
            <KpiCard titulo="Mermas (quemados)" valor={`${fmtNumero(d.mermas.totalUnidades)} un.`} />
            <KpiCard titulo="Lotes con desvío" valor={String(d.lotesConDesvio)} alerta={d.lotesConDesvio > 0} />
          </div>

          {/* Ventas por medio */}
          {d.ventasPorMedio.length > 0 && (
            <div className="rounded-xl border border-borde bg-white p-4">
              <h2 className="mb-3 text-base font-bold">Ventas por medio de pago</h2>
              <div className="flex flex-col gap-1.5">
                {d.ventasPorMedio.map((v) => (
                  <div key={v.medio} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{LABEL_MEDIO[v.medio] ?? v.medio}</span>
                    <span className="font-bold">{fmtMoneda(v.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Atenciones */}
          {d.cantidadAtenciones > 0 && (
            <div className="rounded-xl border border-borde bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Atenciones / regalías</span>
                <span className="font-bold">{d.cantidadAtenciones}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  titulo,
  valor,
  alerta,
}: {
  titulo: string;
  valor: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        alerta ? 'border-error/30 bg-error/5' : 'border-borde bg-white'
      }`}
    >
      <div className="text-xs font-semibold text-texto-suave">{titulo}</div>
      <div className={`mt-1 text-xl font-extrabold ${alerta ? 'text-error' : ''}`}>{valor}</div>
    </div>
  );
}
