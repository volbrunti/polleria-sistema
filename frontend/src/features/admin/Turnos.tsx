import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  desbloquearTurno,
  generarClaveEmergencia,
  listarTurnos,
  resumenDeTurno,
} from '../../api/turnos';
import { listarSucursales } from '../../api/sucursales';
import { fmtFechaHora, fmtMoneda, fmtNumero } from '../../lib/formato';
import { ApiError } from '../../api/client';
import type { Arqueo, ClaveEmergencia, Turno } from '../../api/types';

const ESTILO_ESTADO: Record<string, string> = {
  ABIERTO: '#1a7f3f',
  BLOQUEADO: '#a02514',
  CERRADO: '#555f58',
};

const LABEL_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  MERCADO_PAGO: 'Mercado Pago',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferencia',
};

interface Props {
  puedeEscribir: boolean; // SOCIO = solo lectura
}

// Panel de turnos (§5.3 paso 4): el ADMIN/SOCIO ve TODO lo financiero —
// arqueos con esperado/diferencia, ventas por medio, gastos, retiros por
// socio. El desbloqueo y las claves de emergencia son solo ADMIN.
export function Turnos({ puedeEscribir }: Props) {
  const queryClient = useQueryClient();
  const [sucursalId, setSucursalId] = useState<number | undefined>();
  const [turnoAbierto, setTurnoAbierto] = useState<number | null>(null);
  const [clave, setClave] = useState<ClaveEmergencia | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sucursalesQ = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const turnosQ = useQuery({
    queryKey: ['turnos', sucursalId],
    queryFn: () => listarTurnos({ sucursalId }),
    refetchInterval: 30_000,
  });

  const mutDesbloquear = useMutation({
    mutationFn: desbloquearTurno,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['turnos'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo desbloquear.'),
  });

  const mutClave = useMutation({
    mutationFn: (turnoId: number) => generarClaveEmergencia(turnoId),
    onSuccess: (c) => setClave(c),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo generar la clave.'),
  });

  const locales = sucursalesQ.data?.filter((s) => s.tipo === 'VENTA') ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold">Turnos de caja</h1>
          <div className="mt-1 text-sm text-texto-suave">
            Arqueos, ventas, gastos y retiros de cada turno. Desbloqueo de cajas.
          </div>
        </div>
        <select
          value={sucursalId ?? ''}
          onChange={(e) => setSucursalId(e.target.value ? Number(e.target.value) : undefined)}
          className="min-h-11 rounded-[10px] border border-borde-fuerte bg-white px-3 text-sm font-semibold"
        >
          <option value="">Todas las sucursales</option>
          {locales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl bg-error-suave px-3.5 py-3 text-sm font-semibold text-error-texto">{error}</div>
      )}

      <div className="flex flex-col gap-2.5">
        {turnosQ.isLoading && <div className="text-texto-suave">Cargando…</div>}
        {turnosQ.data?.map((t) => (
          <TarjetaTurno
            key={t.id}
            turno={t}
            expandido={turnoAbierto === t.id}
            puedeEscribir={puedeEscribir}
            onToggle={() => setTurnoAbierto((actual) => (actual === t.id ? null : t.id))}
            onDesbloquear={() => mutDesbloquear.mutate(t.id)}
            onGenerarClave={() => mutClave.mutate(t.id)}
            desbloqueando={mutDesbloquear.isPending}
          />
        ))}
        {turnosQ.data?.length === 0 && (
          <div className="rounded-2xl border border-borde bg-white p-6 text-center text-texto-suave">
            Todavía no hay turnos registrados.
          </div>
        )}
      </div>

      {/* La clave se muestra UNA sola vez (§5.1 camino B) */}
      {clave && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">Clave de emergencia</div>
            <div className="rounded-2xl bg-chip px-8 py-4 font-mono text-4xl font-extrabold tracking-[0.25em]">
              {clave.codigo}
            </div>
            <div className="text-sm text-texto-suave">
              Dictásela al cajero por teléfono. Expira {fmtFechaHora(clave.expiraEn)} y sirve UNA sola vez.
              <br />
              No se vuelve a mostrar: si se pierde, generá otra (esta queda invalidada).
            </div>
            <button
              type="button"
              onClick={() => setClave(null)}
              className="mt-1 min-h-[52px] w-full cursor-pointer rounded-2xl bg-primario text-base font-extrabold text-white"
            >
              ENTENDIDO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaTurno({
  turno,
  expandido,
  puedeEscribir,
  onToggle,
  onDesbloquear,
  onGenerarClave,
  desbloqueando,
}: {
  turno: Turno;
  expandido: boolean;
  puedeEscribir: boolean;
  onToggle: () => void;
  onDesbloquear: () => void;
  onGenerarClave: () => void;
  desbloqueando: boolean;
}) {
  return (
    <div className="rounded-2xl border border-borde bg-white">
      <button type="button" onClick={onToggle} className="flex w-full cursor-pointer items-center gap-3 px-4.5 py-3.5 text-left">
        <span className="font-mono text-sm text-texto-suave">#{String(turno.id).padStart(4, '0')}</span>
        <span className="text-sm font-semibold">{turno.sucursal}</span>
        <span className="text-sm text-texto-suave">{turno.usuarioCajero}</span>
        <span className="text-sm text-texto-suave">{fmtFechaHora(turno.fechaApertura)}</span>
        {turno.fechaCierre && <span className="text-sm text-texto-suave">→ {fmtFechaHora(turno.fechaCierre)}</span>}
        <span className="ml-auto text-[13px] font-extrabold" style={{ color: ESTILO_ESTADO[turno.estado] }}>
          {turno.estado}
        </span>
        <span className="text-texto-suave">{expandido ? '▾' : '▸'}</span>
      </button>

      {turno.estado === 'BLOQUEADO' && puedeEscribir && (
        <div className="flex flex-wrap gap-2 border-t border-[#eef1ea] px-4.5 py-3">
          <button
            type="button"
            disabled={desbloqueando}
            onClick={onDesbloquear}
            className="min-h-11 cursor-pointer rounded-[10px] bg-primario px-4.5 text-sm font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            DESBLOQUEAR TURNO
          </button>
          <button
            type="button"
            onClick={onGenerarClave}
            className="min-h-11 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4.5 text-sm font-bold text-texto"
          >
            Generar clave de emergencia
          </button>
        </div>
      )}

      {expandido && <DetalleTurno turnoId={turno.id} />}
    </div>
  );
}

function FilaArqueo({ arqueo }: { arqueo: Arqueo }) {
  const dif = arqueo.diferencia != null ? Number(arqueo.diferencia) : null;
  const esEfectivo = arqueo.tipo === 'EFECTIVO';
  const fmt = (v: string | null | undefined) =>
    v == null ? '—' : esEfectivo ? fmtMoneda(v) : fmtNumero(v, 1);
  return (
    <div className="grid grid-cols-[110px_130px_1fr_1fr_1fr_110px] items-center gap-x-3 border-t border-[#eef1ea] px-4 py-2.5 text-sm">
      <span className="font-semibold">{arqueo.momento === 'APERTURA' ? 'Apertura' : 'Cierre'}</span>
      <span className="text-texto-suave">{esEfectivo ? 'Efectivo' : 'Pollos marcados'}</span>
      <span className="text-right">{fmt(arqueo.valorContado)}</span>
      <span className="text-right">{fmt(arqueo.valorEsperado)}</span>
      <span className="text-right font-extrabold" style={dif != null && dif !== 0 ? { color: '#a02514' } : undefined}>
        {fmt(arqueo.diferencia)}
      </span>
      <span
        className="text-right text-[13px] font-extrabold"
        style={{ color: arqueo.resultado === 'COINCIDE' ? '#1a7f3f' : '#a02514' }}
      >
        {arqueo.resultado ?? '—'}
      </span>
    </div>
  );
}

function DetalleTurno({ turnoId }: { turnoId: number }) {
  const resumenQ = useQuery({ queryKey: ['turnos', turnoId, 'resumen'], queryFn: () => resumenDeTurno(turnoId) });

  if (resumenQ.isLoading) return <div className="border-t border-[#eef1ea] px-4.5 py-4 text-texto-suave">Cargando…</div>;
  const r = resumenQ.data;
  if (!r) return null;

  const totalVentas = r.ventasPorMedio.reduce((acc, v) => acc + Number(v.total), 0);
  const totalGastos = (r.turno.gastos ?? []).reduce((acc, g) => acc + Number(g.monto), 0);
  const totalRetiros = (r.turno.retiros ?? []).reduce((acc, x) => acc + Number(x.monto), 0);

  return (
    <div className="flex flex-col gap-3.5 border-t border-[#eef1ea] bg-panel px-4.5 py-4">
      {/* Arqueos: contado vs esperado — el corazón del control */}
      <div className="rounded-xl border border-borde bg-white">
        <div className="grid grid-cols-[110px_130px_1fr_1fr_1fr_110px] gap-x-3 px-4 py-2.5 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>MOMENTO</span>
          <span>TIPO</span>
          <span className="text-right">CONTADO</span>
          <span className="text-right">ESPERADO</span>
          <span className="text-right">DIFERENCIA</span>
          <span className="text-right">RESULTADO</span>
        </div>
        {(r.turno.arqueos ?? []).map((a) => (
          <FilaArqueo key={a.id} arqueo={a} />
        ))}
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        {/* Ventas por medio */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">VENTAS POR MEDIO DE PAGO</div>
          {r.ventasPorMedio.length === 0 && <div className="text-sm text-texto-suave">Sin ventas cobradas.</div>}
          {r.ventasPorMedio.map((v) => (
            <div key={v.medio} className="flex justify-between py-1 text-sm">
              <span>{LABEL_MEDIO[v.medio] ?? v.medio}</span>
              <span className="font-bold">{fmtMoneda(v.total)}</span>
            </div>
          ))}
          <div className="mt-1.5 flex justify-between border-t border-borde pt-2 text-sm font-extrabold">
            <span>Total</span>
            <span>{fmtMoneda(totalVentas)}</span>
          </div>
        </div>

        {/* Unidades vendidas */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">UNIDADES VENDIDAS</div>
          {r.unidadesVendidas.length === 0 && <div className="text-sm text-texto-suave">—</div>}
          {r.unidadesVendidas.map((u) => (
            <div key={u.productoId} className="flex justify-between py-1 text-sm">
              <span>{u.producto}</span>
              <span className="font-bold">{fmtNumero(u.unidades, 1)}</span>
            </div>
          ))}
        </div>

        {/* Gastos */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">GASTOS DE CAJA</div>
          {(r.turno.gastos ?? []).length === 0 && <div className="text-sm text-texto-suave">Sin gastos.</div>}
          {(r.turno.gastos ?? []).map((g) => (
            <div key={g.id} className="flex justify-between gap-2 py-1 text-sm">
              <span>
                {g.categoria}
                {g.descripcion && <span className="text-texto-suave"> — {g.descripcion}</span>}
                <span className="text-texto-suave"> · {LABEL_MEDIO[g.medio] ?? g.medio}</span>
              </span>
              <span className="font-bold">{fmtMoneda(g.monto)}</span>
            </div>
          ))}
          {(r.turno.gastos ?? []).length > 0 && (
            <div className="mt-1.5 flex justify-between border-t border-borde pt-2 text-sm font-extrabold">
              <span>Total</span>
              <span>{fmtMoneda(totalGastos)}</span>
            </div>
          )}
        </div>

        {/* Retiros por socio */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">RETIROS POR SOCIO</div>
          {(r.turno.retiros ?? []).length === 0 && <div className="text-sm text-texto-suave">Sin retiros.</div>}
          {(r.turno.retiros ?? []).map((x) => (
            <div key={x.id} className="flex justify-between gap-2 py-1 text-sm">
              <span>
                {x.socio.charAt(0) + x.socio.slice(1).toLowerCase()}
                <span className="text-texto-suave"> · {LABEL_MEDIO[x.medio] ?? x.medio} · {fmtFechaHora(x.fechaHora)}</span>
              </span>
              <span className="font-bold">{fmtMoneda(x.monto)}</span>
            </div>
          ))}
          {(r.turno.retiros ?? []).length > 0 && (
            <div className="mt-1.5 flex justify-between border-t border-borde pt-2 text-sm font-extrabold">
              <span>Total</span>
              <span>{fmtMoneda(totalRetiros)}</span>
            </div>
          )}
        </div>

        {/* Atenciones */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">ATENCIONES / REGALÍAS</div>
          {(r.turno.atenciones ?? []).length === 0 && <div className="text-sm text-texto-suave">Sin atenciones.</div>}
          {(r.turno.atenciones ?? []).map((a) => (
            <div key={a.id} className="flex justify-between gap-2 py-1 text-sm">
              <span>
                {fmtNumero(a.cantidad, 1)} × {a.producto?.nombre}
                <span className="text-texto-suave"> · {a.motivoCodigo}{a.motivoDetalle ? ` (${a.motivoDetalle})` : ''}</span>
              </span>
              <span className="text-texto-suave">{a.usuario?.username}</span>
            </div>
          ))}
        </div>

        {/* Marcados de pollo */}
        <div className="rounded-xl border border-borde bg-white p-4">
          <div className="mb-2 text-xs font-extrabold tracking-wide text-texto-suave">MARCADOS DE POLLO</div>
          {(r.turno.eventosMarcado ?? []).length === 0 && <div className="text-sm text-texto-suave">Sin marcados.</div>}
          {(r.turno.eventosMarcado ?? []).map((e) => (
            <div key={e.id} className="flex justify-between py-1 text-sm">
              <span>{fmtFechaHora(e.fechaHora)}</span>
              <span className="font-bold">{e.cantidad} pollos a la parrilla</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
