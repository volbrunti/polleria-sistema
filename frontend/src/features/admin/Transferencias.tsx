import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmarConDiscrepancia,
  intentosDeRecepcion,
  listarTransferencias,
} from '../../api/transferencias';
import { listarAlertas } from '../../api/alertas';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';
import { ApiError } from '../../api/client';
import type { Transferencia } from '../../api/types';

const ESTILO_ESTADO: Record<string, string> = {
  PENDIENTE_RECEPCION: '#7a5d00',
  CONFIRMADA: '#1a7f3f',
  CONFIRMADA_CON_DISCREPANCIA: '#a02514',
};

const LABEL_ESTADO: Record<string, string> = {
  PENDIENTE_RECEPCION: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  CONFIRMADA_CON_DISCREPANCIA: 'Con discrepancia',
};

interface Props {
  puedeEscribir: boolean; // SOCIO = solo lectura; destrabar es solo ADMIN
}

export function Transferencias({ puedeEscribir }: Props) {
  const transferencias = useQuery({ queryKey: ['transferencias'], queryFn: () => listarTransferencias() });
  const [searchParams] = useSearchParams();
  const [resolviendo, setResolviendo] = useState<Transferencia | null>(null);

  // Recepciones trabadas: siguen pendientes y ya tienen una alerta de
  // discrepancia — el cajero contó, no le dio, y no puede cerrarlas él.
  const alertasQ = useQuery({
    queryKey: ['alertas', 'DISCREPANCIA_TRANSFERENCIA'],
    queryFn: () => listarAlertas({ tipo: 'DISCREPANCIA_TRANSFERENCIA' }),
    refetchInterval: 30_000,
  });

  const trabadas = useMemo(() => {
    const conAlerta = new Set(alertasQ.data?.map((a) => a.origenId) ?? []);
    return (transferencias.data ?? []).filter(
      (t) => t.estado === 'PENDIENTE_RECEPCION' && conAlerta.has(t.id),
    );
  }, [transferencias.data, alertasQ.data]);

  // Llegada desde una alerta (Alertas.tsx "Ver transferencia"): scrollea a la fila.
  const transferenciaDestacada = searchParams.get('transferencia')
    ? Number(searchParams.get('transferencia'))
    : null;
  useEffect(() => {
    if (transferenciaDestacada == null) return;
    document.getElementById(`transferencia-${transferenciaDestacada}`)?.scrollIntoView({ block: 'center' });
  }, [transferenciaDestacada, transferencias.data]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-2xl font-extrabold">Transferencias</h1>
        <div className="mt-1 text-sm text-texto-suave">Enviado vs. recibido, con ambas firmas.</div>
      </div>

      {trabadas.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-error bg-error-suave p-4.5">
          <div>
            <div className="text-base font-extrabold text-error-texto">
              {trabadas.length === 1
                ? 'Hay 1 recepción trabada'
                : `Hay ${trabadas.length} recepciones trabadas`}
            </div>
            <div className="text-sm text-error-texto">
              El cajero contó y no coincidió con el remito. Él no puede cerrarlas: la decisión es tuya.
            </div>
          </div>
          {trabadas.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white px-4 py-3 text-sm"
            >
              <span className="font-mono text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
              <span className="font-semibold">
                {t.sucursalOrigen} → {t.sucursalDestino}
              </span>
              <span className="text-texto-suave">{fmtFechaHora(t.fechaHoraEnvio)}</span>
              <span className="text-texto-suave">
                {t.lineas.length === 1 ? t.lineas[0].producto : `${t.lineas.length} productos`}
              </span>
              {puedeEscribir && (
                <button
                  type="button"
                  onClick={() => setResolviendo(t)}
                  className="ml-auto min-h-10 cursor-pointer rounded-xl bg-error px-4 text-sm font-extrabold text-white"
                >
                  REVISAR Y CERRAR
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="tabla-cards overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="tabla-encabezado grid min-w-[1060px] grid-cols-[90px_110px_150px_1fr_90px_90px_80px_170px_130px] gap-x-3 bg-chip px-4.5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>REMITO</span>
          <span>FECHA</span>
          <span>RUTA</span>
          <span>PRODUCTO</span>
          <span className="text-right">ENVIADO</span>
          <span className="text-right">RECIBIDO</span>
          <span className="text-right">DIF.</span>
          <span>FIRMAS</span>
          <span>ESTADO</span>
        </div>
        {transferencias.isLoading && <div className="px-4.5 py-4 text-texto-suave">Cargando…</div>}
        {transferencias.data?.flatMap((t) =>
          t.lineas.map((l) => {
            const dif = l.diferencia != null ? Number(l.diferencia) : null;
            return (
              <div
                key={`${t.id}-${l.id}`}
                id={`transferencia-${t.id}`}
                className={`tabla-fila grid min-w-[1060px] grid-cols-[90px_110px_150px_1fr_90px_90px_80px_170px_130px] items-center gap-x-3 border-t border-[#eef1ea] px-4.5 py-3 text-sm ${
                  t.id === transferenciaDestacada ? 'bg-[#fff7d9]' : ''
                }`}
              >
                <span className="font-mono text-texto-suave">T-{String(t.id).padStart(5, '0')}</span>
                <span data-col="FECHA" className="text-texto-suave">{fmtFechaHora(t.fechaHoraEnvio)}</span>
                <span data-col="RUTA">
                  {t.sucursalOrigen} → {t.sucursalDestino}
                </span>
                <span className="font-semibold">{l.producto}</span>
                <span data-col="ENVIADO" className="text-right">{l.cantidadEnviada != null ? fmtNumero(l.cantidadEnviada) : '—'}</span>
                <span data-col="RECIBIDO" className="text-right">{l.cantidadRecibida != null ? fmtNumero(l.cantidadRecibida) : '—'}</span>
                <span data-col="DIF." className="text-right font-extrabold" style={dif != null && dif !== 0 ? { color: '#a02514' } : undefined}>
                  {dif != null ? fmtNumero(dif) : '—'}
                </span>
                <span data-col="FIRMAS" className="text-[13px] text-texto-suave">
                  {t.usuarioEmisor} → {t.usuarioReceptor ?? '—'}
                </span>
                <span data-col="ESTADO" className="text-[13px] font-extrabold" style={{ color: ESTILO_ESTADO[t.estado] }}>
                  {LABEL_ESTADO[t.estado]}
                </span>
              </div>
            );
          }),
        )}
      </div>

      {resolviendo && (
        <ModalResolver transferencia={resolviendo} onCerrar={() => setResolviendo(null)} />
      )}
    </div>
  );
}

// Destrabar una recepción: el admin ve la secuencia completa de conteos (los
// dos números, que es justo lo que el control ciego le esconde al cajero) y
// decide con qué cantidad entra la mercadería al local.
function ModalResolver({
  transferencia,
  onCerrar,
}: {
  transferencia: Transferencia;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<number, string>>({});

  const intentosQ = useQuery({
    queryKey: ['transferencia-intentos', transferencia.id],
    queryFn: () => intentosDeRecepcion(transferencia.id),
  });

  const ultimoIntento = intentosQ.data?.[intentosQ.data.length - 1];

  // Arranca con lo último que contó el cajero: en general es lo que realmente
  // llegó, y el admin solo confirma. Si sabe otra cosa, lo edita.
  useEffect(() => {
    if (!ultimoIntento) return;
    setValores((actuales) =>
      Object.keys(actuales).length > 0
        ? actuales
        : Object.fromEntries(ultimoIntento.lineas.map((l) => [l.productoId, l.cantidadContada])),
    );
  }, [ultimoIntento]);

  const mutCerrar = useMutation({
    mutationFn: () =>
      confirmarConDiscrepancia(
        transferencia.id,
        transferencia.lineas.map((l) => ({
          productoId: l.productoId,
          cantidadRecibida: Number(valores[l.productoId] ?? 0),
        })),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      void queryClient.invalidateQueries({ queryKey: ['alertas'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onCerrar();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'No se pudo cerrar. Probá de nuevo.'),
  });

  const invalido = transferencia.lineas.some((l) => {
    const v = valores[l.productoId];
    return v == null || v === '' || Number.isNaN(Number(v)) || Number(v) < 0;
  });

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-auto rounded-3xl bg-white p-6">
        <div>
          <div className="text-xl font-extrabold">
            Recepción trabada — T-{String(transferencia.id).padStart(5, '0')}
          </div>
          <div className="mt-0.5 text-sm text-texto-suave">
            {transferencia.sucursalOrigen} → {transferencia.sucursalDestino} ·{' '}
            {fmtFechaHora(transferencia.fechaHoraEnvio)} · envió {transferencia.usuarioEmisor}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="text-xs font-extrabold tracking-wide text-texto-suave">CONTEOS DEL CAJERO</div>
          {intentosQ.isLoading && <div className="text-texto-suave">Cargando…</div>}
          {intentosQ.data?.map((intento) => (
            <div
              key={intento.numero}
              className={`rounded-2xl border p-3.5 ${
                intento.coincidio ? 'border-primario bg-[#f2f8f3]' : 'border-borde'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 text-sm">
                <span className="font-extrabold">Conteo {intento.numero}</span>
                <span className="text-texto-suave">{fmtFechaHora(intento.fechaHora)}</span>
                {intento.usuario && <span className="text-texto-suave">· {intento.usuario}</span>}
                {intento.coincidio && (
                  <span className="ml-auto text-[13px] font-extrabold text-primario">COINCIDIÓ</span>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {intento.lineas.map((l) => {
                  const dif = Number(l.diferencia);
                  return (
                    <div key={l.productoId} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 font-semibold">{l.producto}</span>
                      <span className="text-texto-suave">
                        remito {fmtNumero(l.cantidadEnviada)} · contó {fmtNumero(l.cantidadContada)}
                      </span>
                      <span
                        className="w-20 text-right font-extrabold"
                        style={dif !== 0 ? { color: '#a02514' } : { color: '#1a7f3f' }}
                      >
                        {dif > 0 ? `+${fmtNumero(dif)}` : fmtNumero(dif)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 rounded-2xl border border-borde bg-chip p-3.5">
          <div className="text-xs font-extrabold tracking-wide text-texto-suave">
            ¿CON QUÉ CANTIDAD ENTRA AL LOCAL?
          </div>
          {transferencia.lineas.map((l) => (
            <label key={l.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1 font-semibold">{l.producto}</span>
              <input
                type="number"
                min={0}
                step="0.001"
                value={valores[l.productoId] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [l.productoId]: e.target.value }))}
                className="min-h-11 w-32 rounded-xl border border-borde-fuerte bg-white px-3 text-right text-base font-bold"
              />
            </label>
          ))}
          <div className="text-[13px] text-texto-suave">
            Queda registrado como <strong>confirmada con discrepancia</strong>, con tu firma y los dos
            números. El stock del local entra con lo que pongas acá.
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-error-suave px-3.5 py-3 text-sm font-semibold text-error-texto">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-13 flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
          >
            CANCELAR
          </button>
          <button
            type="button"
            disabled={invalido || mutCerrar.isPending}
            onClick={() => {
              setError(null);
              mutCerrar.mutate();
            }}
            className="min-h-13 flex-1 cursor-pointer rounded-2xl bg-primario text-base font-extrabold text-white disabled:opacity-50"
          >
            {mutCerrar.isPending ? 'CERRANDO…' : 'CERRAR RECEPCIÓN'}
          </button>
        </div>
      </div>
    </div>
  );
}
