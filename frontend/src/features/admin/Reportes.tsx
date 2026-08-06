import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarSucursales } from '../../api/sucursales';
import {
  ventasPorProducto,
  ventasPorMedio,
  cierresDeCaja,
  retirosPorSocio,
  mermasPorProducto,
  rendimientoProduccion,
  gastosPorCategoria,
  atencionesReporte,
  trazabilidadPedido,
  type FiltrosFecha,
  type OrigenProducto,
} from '../../api/reportes';
import { fmtMoneda, fmtNumero, fmtFechaHora } from '../../lib/formato';

const TABS = [
  { key: 'ventas', label: 'Ventas' },
  { key: 'medios', label: 'Medios de pago' },
  { key: 'cierres', label: 'Cierres de caja' },
  { key: 'retiros', label: 'Retiros' },
  { key: 'gastos', label: 'Gastos' },
  { key: 'mermas', label: 'Mermas' },
  { key: 'produccion', label: 'Producción' },
  { key: 'atenciones', label: 'Atenciones' },
  { key: 'trazabilidad', label: 'Trazabilidad' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const LABEL_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  MERCADO_PAGO: 'Mercado Pago',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferencia',
};

function hace7DiasISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function Reportes() {
  const [tab, setTab] = useState<TabKey>('ventas');
  const [desde, setDesde] = useState(hace7DiasISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [sucursalId, setSucursalId] = useState<number | undefined>();

  const sucursalesQ = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const locales = sucursalesQ.data?.filter((s) => s.tipo === 'VENTA') ?? [];

  const filtros: FiltrosFecha = {
    desde: desde ? `${desde}T00:00:00` : undefined,
    hasta: hasta ? `${hasta}T23:59:59` : undefined,
    sucursalId,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold">Reportes</h1>
          <div className="mt-1 text-sm text-texto-suave">
            Análisis detallado por período y sucursal
          </div>
        </div>
        {tab !== 'trazabilidad' && (
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
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#e6e9e2] p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-9 cursor-pointer whitespace-nowrap rounded-lg px-3 text-sm font-bold ${
              tab === t.key ? 'bg-primario text-white' : 'bg-transparent text-texto hover:bg-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ventas' && <TabVentas filtros={filtros} />}
      {tab === 'medios' && <TabMedios filtros={filtros} />}
      {tab === 'cierres' && <TabCierres filtros={filtros} />}
      {tab === 'retiros' && <TabRetiros filtros={filtros} />}
      {tab === 'gastos' && <TabGastos filtros={filtros} />}
      {tab === 'mermas' && <TabMermas filtros={filtros} />}
      {tab === 'produccion' && <TabProduccion filtros={filtros} />}
      {tab === 'atenciones' && <TabAtenciones filtros={filtros} />}
      {tab === 'trazabilidad' && <TabTrazabilidad />}
    </div>
  );
}

// ── Tabs ──

function TabVentas({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'ventas', filtros],
    queryFn: () => ventasPorProducto(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.length) return <Vacio />;

  const total = q.data.reduce((acc, v) => acc + Number(v.montoTotal), 0);

  return (
    <div className="rounded-xl border border-borde bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde bg-[#f7f8f5]">
              <th className="px-3 py-2.5 text-left font-bold">Producto</th>
              <th className="px-3 py-2.5 text-left font-bold">Categoría</th>
              <th className="px-3 py-2.5 text-right font-bold">Unidades</th>
              <th className="px-3 py-2.5 text-right font-bold">Monto</th>
              <th className="px-3 py-2.5 text-right font-bold">Pedidos</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((v) => (
              <tr key={v.productoId} className="border-b border-borde/50">
                <td className="px-3 py-2 font-medium">{v.producto}</td>
                <td className="px-3 py-2 text-texto-suave">{v.categoria}</td>
                <td className="px-3 py-2 text-right">{fmtNumero(v.unidadesVendidas)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMoneda(v.montoTotal)}</td>
                <td className="px-3 py-2 text-right">{v.cantidadPedidos}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#f7f8f5] font-bold">
              <td colSpan={3} className="px-3 py-2.5">
                Total
              </td>
              <td className="px-3 py-2.5 text-right">{fmtMoneda(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function TabMedios({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'medios', filtros],
    queryFn: () => ventasPorMedio(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.porMedio.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white p-4">
      <div className="flex flex-col gap-3">
        {q.data.porMedio.map((m) => (
          <div key={m.medio} className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">{LABEL_MEDIO[m.medio] ?? m.medio}</div>
              <div className="text-xs text-texto-suave">
                {m.cantidadOperaciones} operaciones
                {Number(m.recargo) > 0 && ` · ${fmtMoneda(m.recargo)} de recargo`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold">{fmtMoneda(m.total)}</div>
              <div className="text-xs text-texto-suave">{m.porcentaje}%</div>
            </div>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-borde pt-3 font-bold">
          <span>Total</span>
          <span>{fmtMoneda(q.data.total)}</span>
        </div>
        {/* El recargo lo paga el cliente encima del precio: no es venta */}
        {Number(q.data.totalRecargos) > 0 && (
          <div className="flex items-center justify-between text-sm text-advertencia-texto">
            <span>Recargos de tarjeta (aparte)</span>
            <span className="font-bold">{fmtMoneda(q.data.totalRecargos)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TabCierres({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'cierres', filtros],
    queryFn: () => cierresDeCaja(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.length) return <Vacio />;

  return (
    <div className="flex flex-col gap-3">
      {q.data.map((c) => {
        const hayDiscrepancia =
          (c.efectivo?.resultado && c.efectivo.resultado !== 'COINCIDE') ||
          (c.pollos?.resultado && c.pollos.resultado !== 'COINCIDE');
        return (
          <div
            key={c.turnoId}
            className={`rounded-xl border p-4 ${
              hayDiscrepancia ? 'border-error/30 bg-error/5' : 'border-borde bg-white'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold">{c.sucursal}</div>
                <div className="text-xs text-texto-suave">
                  Cajero: {c.cajero} &middot; {c.fechaCierre ? fmtFechaHora(c.fechaCierre) : '—'}
                </div>
              </div>
              {hayDiscrepancia && (
                <span className="rounded-md bg-error/10 px-2 py-0.5 text-xs font-bold text-error">
                  DISCREPANCIA
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {c.efectivo && (
                <div>
                  <div className="text-xs font-semibold text-texto-suave">Efectivo</div>
                  <div>Contado: {fmtMoneda(c.efectivo.valorContado)}</div>
                  <div>Esperado: {fmtMoneda(c.efectivo.valorEsperado)}</div>
                  {c.efectivo.resultado !== 'COINCIDE' && (
                    <div className="font-bold text-error">
                      {c.efectivo.resultado === 'FALTANTE' ? 'Faltante' : 'Sobrante'}:{' '}
                      {fmtMoneda(Math.abs(Number(c.efectivo.diferencia)))}
                    </div>
                  )}
                </div>
              )}
              {c.pollos && (
                <div>
                  <div className="text-xs font-semibold text-texto-suave">Pollos marcados</div>
                  <div>Contado: {fmtNumero(c.pollos.valorContado)}</div>
                  <div>Esperado: {fmtNumero(c.pollos.valorEsperado)}</div>
                  {c.pollos.resultado !== 'COINCIDE' && (
                    <div className="font-bold text-error">
                      {c.pollos.resultado === 'FALTANTE' ? 'Faltante' : 'Sobrante'}:{' '}
                      {fmtNumero(Math.abs(Number(c.pollos.diferencia)))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabRetiros({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'retiros', filtros],
    queryFn: () => retirosPorSocio(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.porSocio.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white p-4">
      <div className="flex flex-col gap-2">
        {q.data.porSocio.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <div>
              <span className="font-semibold">{r.socio}</span>
              <span className="ml-2 text-texto-suave">({LABEL_MEDIO[r.medio] ?? r.medio})</span>
            </div>
            <div className="text-right">
              <span className="font-bold">{fmtMoneda(r.total)}</span>
              <span className="ml-2 text-xs text-texto-suave">{r.cantidadRetiros} retiros</span>
            </div>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-borde pt-3 font-bold">
          <span>Total</span>
          <span>{fmtMoneda(q.data.total)}</span>
        </div>
      </div>
    </div>
  );
}

function TabGastos({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'gastos', filtros],
    queryFn: () => gastosPorCategoria(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.porCategoria.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white p-4">
      <div className="flex flex-col gap-2">
        {q.data.porCategoria.map((g) => (
          <div key={g.categoria} className="flex items-center justify-between text-sm">
            <div>
              <span className="font-semibold">{g.categoria}</span>
              <span className="ml-2 text-xs text-texto-suave">{g.cantidad} gastos</span>
            </div>
            <span className="font-bold">{fmtMoneda(g.total)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-borde pt-3 font-bold">
          <span>Total</span>
          <span>{fmtMoneda(q.data.total)}</span>
        </div>
      </div>
    </div>
  );
}

function TabMermas({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'mermas', filtros],
    queryFn: () => mermasPorProducto(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde bg-[#f7f8f5]">
              <th className="px-3 py-2.5 text-left font-bold">Producto</th>
              <th className="px-3 py-2.5 text-right font-bold">Quemados</th>
              <th className="px-3 py-2.5 text-right font-bold">Desperdicio prod.</th>
              <th className="px-3 py-2.5 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((m) => (
              <tr key={m.productoId} className="border-b border-borde/50">
                <td className="px-3 py-2 font-medium">{m.producto}</td>
                <td className="px-3 py-2 text-right">{fmtNumero(m.quemados)}</td>
                <td className="px-3 py-2 text-right">{fmtNumero(m.desperdicioProduccion)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtNumero(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabProduccion({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'produccion', filtros],
    queryFn: () => rendimientoProduccion(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde bg-[#f7f8f5]">
              <th className="px-3 py-2.5 text-left font-bold">Producto</th>
              <th className="px-3 py-2.5 text-left font-bold">Operario</th>
              <th className="px-3 py-2.5 text-left font-bold">Fecha</th>
              <th className="px-3 py-2.5 text-right font-bold">Producidas</th>
              <th className="px-3 py-2.5 text-right font-bold">Esperadas</th>
              <th className="px-3 py-2.5 text-right font-bold">Desvío</th>
              <th className="px-3 py-2.5 text-right font-bold">Desperdicio</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((l) => {
              const desvio = l.desvioPct ? Number(l.desvioPct) : 0;
              const esAlerta = l.alertaDisparada;
              return (
                <tr
                  key={l.loteId}
                  className={`border-b border-borde/50 ${esAlerta ? 'bg-error/5' : ''}`}
                >
                  <td className="px-3 py-2 font-medium">{l.producto}</td>
                  <td className="px-3 py-2">{l.operario}</td>
                  <td className="px-3 py-2 text-texto-suave">{fmtFechaHora(l.fechaHora)}</td>
                  <td className="px-3 py-2 text-right">
                    {l.unidadesProducidas ? fmtNumero(l.unidadesProducidas) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.unidadesEsperadas ? fmtNumero(l.unidadesEsperadas) : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      esAlerta ? 'text-error' : Math.abs(desvio) > 5 ? 'text-amber-600' : ''
                    }`}
                  >
                    {l.desvioPct ? `${fmtNumero(l.desvioPct, 1)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.desperdicioRealKg ? `${fmtNumero(l.desperdicioRealKg)} kg` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabAtenciones({ filtros }: { filtros: FiltrosFecha }) {
  const q = useQuery({
    queryKey: ['reportes', 'atenciones', filtros],
    queryFn: () => atencionesReporte(filtros),
  });

  if (q.isLoading) return <Cargando />;
  if (!q.data?.length) return <Vacio />;

  return (
    <div className="rounded-xl border border-borde bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde bg-[#f7f8f5]">
              <th className="px-3 py-2.5 text-left font-bold">Producto</th>
              <th className="px-3 py-2.5 text-right font-bold">Cantidad</th>
              <th className="px-3 py-2.5 text-left font-bold">Motivo</th>
              <th className="px-3 py-2.5 text-left font-bold">Usuario</th>
              <th className="px-3 py-2.5 text-left font-bold">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((a) => (
              <tr key={a.id} className="border-b border-borde/50">
                <td className="px-3 py-2 font-medium">{a.producto}</td>
                <td className="px-3 py-2 text-right">{fmtNumero(a.cantidad)}</td>
                <td className="px-3 py-2">
                  {a.motivoCodigo}
                  {a.motivoDetalle && (
                    <span className="ml-1 text-texto-suave">({a.motivoDetalle})</span>
                  )}
                </td>
                <td className="px-3 py-2">{a.usuario}</td>
                <td className="px-3 py-2 text-texto-suave">{fmtFechaHora(a.fechaHora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabTrazabilidad() {
  const [input, setInput] = useState('');
  const [pedidoId, setPedidoId] = useState<number | undefined>();

  const q = useQuery({
    queryKey: ['reportes', 'trazabilidad', pedidoId],
    queryFn: () => trazabilidadPedido(pedidoId!),
    enabled: pedidoId !== undefined,
  });

  const buscar = () => {
    const n = Number(input);
    setPedidoId(Number.isInteger(n) && n > 0 ? n : undefined);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-borde bg-white p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-semibold text-texto-suave">
              Número de pedido
            </label>
            <input
              type="number"
              min={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
              placeholder="Ej: 145"
              className="min-h-10 w-full rounded-lg border border-borde-fuerte bg-white px-2.5 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={buscar}
            className="min-h-10 cursor-pointer rounded-lg bg-primario px-4 text-sm font-bold text-white"
          >
            Buscar
          </button>
        </div>
      </div>

      {q.isLoading && <Cargando />}
      {q.error && (
        <p className="py-2 text-sm text-error">
          No se encontró el pedido, o no se pudo cargar la trazabilidad.
        </p>
      )}

      {q.data && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-borde bg-white p-4">
            <div className="font-bold">Pedido #{q.data.pedidoId}</div>
            <div className="text-xs text-texto-suave">
              {q.data.sucursal} &middot; {fmtFechaHora(q.data.fechaCreacion)} &middot; Cajero:{' '}
              {q.data.cajero}
            </div>
          </div>

          {q.data.items.map((item) => (
            <div key={item.itemId} className="rounded-xl border border-borde bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold">
                  {item.producto}{' '}
                  <span className="font-normal text-texto-suave">× {fmtNumero(item.cantidad)}</span>
                </div>
                <div className="font-bold">{fmtMoneda(item.montoTotal)}</div>
              </div>
              {item.esVentaCostoCero && (
                <div className="mt-1 text-xs font-semibold text-amber-600">
                  Costo cero{item.tipoCostoCero ? ` — ${item.tipoCostoCero}` : ''}
                </div>
              )}

              {item.componentes ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-borde pt-3">
                  <div className="text-xs font-semibold text-texto-suave">
                    Combo — componentes:
                  </div>
                  {item.componentes.map((c) => (
                    <div key={c.productoId} className="rounded-lg bg-[#f7f8f5] p-3">
                      <div className="mb-2 text-sm font-semibold">{c.producto}</div>
                      <OrigenDetalle origen={c.origen} />
                    </div>
                  ))}
                </div>
              ) : (
                item.origen && (
                  <div className="mt-3 border-t border-borde pt-3">
                    <OrigenDetalle origen={item.origen} />
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrigenDetalle({ origen }: { origen: OrigenProducto }) {
  if (!origen.transferencia) {
    return <div className="text-xs text-texto-suave">{origen.nota}</div>;
  }
  const t = origen.transferencia;
  const l = origen.lote;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div>
        <span className="font-semibold">Transferencia T-{t.id}:</span> {t.sucursalOrigen} →{' '}
        recibida {fmtFechaHora(t.fechaHoraRecepcion ?? t.fechaHoraEnvio)} &middot; enviado{' '}
        {fmtNumero(t.cantidadEnviada)}, recibido{' '}
        {t.cantidadRecibida ? fmtNumero(t.cantidadRecibida) : '—'} &middot; {t.usuarioEmisor} →{' '}
        {t.usuarioReceptor ?? '—'}
      </div>
      {l ? (
        <div className="rounded-lg bg-[#f7f8f5] p-2.5">
          <div>
            <span className="font-semibold">Lote L-{l.id}</span> (aproximado por fecha, no es FK
            directa) &middot; {fmtFechaHora(l.fechaHora)} &middot; operario {l.operario} &middot;
            ficha v{l.versionFicha}
          </div>
          <div className="mt-1">
            Producidas: {l.unidadesProducidas ? fmtNumero(l.unidadesProducidas) : '—'} &middot;
            Esperadas: {l.unidadesEsperadas ? fmtNumero(l.unidadesEsperadas) : '—'} &middot; Desvío:{' '}
            {l.desvioPct ? `${fmtNumero(l.desvioPct, 1)}%` : '—'}
          </div>
          {origen.insumos.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {origen.insumos.map((i, idx) => (
                <div key={idx} className="text-texto-suave">
                  {i.producto}: {fmtNumero(i.cantidadUsada)} (línea de ingreso #{i.lineaIngresoId},{' '}
                  {i.proveedor}, {fmtFechaHora(i.fechaIngreso)})
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-texto-suave">No se encontró un lote de producción anterior a la transferencia.</div>
      )}
    </div>
  );
}

function Cargando() {
  return <p className="py-6 text-center text-sm text-texto-suave">Cargando...</p>;
}

function Vacio() {
  return <p className="py-6 text-center text-sm text-texto-suave">Sin datos en el período seleccionado.</p>;
}
