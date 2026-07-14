import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarAuditoria } from '../../api/auditoria';
import { listarUsuarios } from '../../api/usuarios';
import { useAuth } from '../../auth/AuthContext';
import { fmtFechaHora } from '../../lib/formato';

// Los datos del registro son JSON arbitrario (datosAnteriores/datosNuevos de
// cualquier entidad) — se muestran como pares campo: valor legibles.
function DetalleJson({ titulo, datos }: { titulo: string; datos: unknown }) {
  if (datos === null || datos === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[11px] font-extrabold tracking-wide text-texto-suave">{titulo}</div>
      <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-chip px-3 py-2.5 font-mono text-[12px] leading-relaxed text-texto">
        {JSON.stringify(datos, null, 2)}
      </pre>
    </div>
  );
}

export function Auditoria() {
  const { usuario: yo } = useAuth();
  const esAdmin = yo?.rol === 'ADMINISTRADOR';
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: listarUsuarios, enabled: esAdmin });
  const [expandido, setExpandido] = useState<number | null>(null);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [usuarioId, setUsuarioId] = useState<number | null>(null);
  const [accion, setAccion] = useState('');
  const [entidad, setEntidad] = useState('');

  const registros = useQuery({
    queryKey: ['auditoria', desde, hasta, usuarioId, accion, entidad],
    queryFn: () =>
      listarAuditoria({
        desde: desde || undefined,
        hasta: hasta ? `${hasta}T23:59:59` : undefined,
        usuarioId: usuarioId ?? undefined,
        accion: accion || undefined,
        entidad: entidad || undefined,
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="m-0 flex-1 text-2xl font-extrabold">Auditoría</h1>
        <span className="rounded-lg bg-[#e6e9e2] px-3 py-1.5 text-[13px] font-extrabold text-texto-suave">SOLO LECTURA</span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        {esAdmin && (
          <select
            value={usuarioId ?? ''}
            onChange={(e) => setUsuarioId(e.target.value ? Number(e.target.value) : null)}
            className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
          >
            <option value="">Todos los usuarios</option>
            {usuarios.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        )}
        <input value={accion} onChange={(e) => setAccion(e.target.value)} placeholder="Acción exacta (ej: CERRAR_LOTE_PRODUCCION)" className="h-11 w-64 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        <input value={entidad} onChange={(e) => setEntidad(e.target.value)} placeholder="Entidad exacta (ej: Transferencia)" className="h-11 w-56 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid min-w-[900px] grid-cols-[150px_150px_190px_150px_1fr] gap-x-3 bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>FECHA / HORA</span>
          <span>USUARIO</span>
          <span>ACCIÓN</span>
          <span>ENTIDAD</span>
          <span>DETALLE</span>
        </div>
        {registros.isLoading && <div className="px-5 py-4 text-texto-suave">Cargando…</div>}
        {registros.data?.map((r) => {
          const tieneDetalle = r.datosAnteriores != null || r.datosNuevos != null;
          const abierto = expandido === r.id;
          return (
            <div key={r.id} className="border-t border-[#eef1ea]">
              <button
                type="button"
                onClick={() => setExpandido(abierto ? null : r.id)}
                disabled={!tieneDetalle}
                className="grid w-full min-w-[900px] cursor-pointer grid-cols-[150px_150px_190px_150px_1fr] gap-x-3 border-0 bg-transparent px-5 py-3.5 text-left text-sm disabled:cursor-default"
              >
                <span className="text-texto-suave">{fmtFechaHora(r.fechaHora)}</span>
                <span className="font-semibold">{r.usuario?.nombre ?? r.usuario?.username}</span>
                <span className="font-mono text-[12px]">{r.accion}</span>
                <span className="text-texto-suave">{r.entidad} #{r.entidadId}</span>
                <span className="truncate text-texto-suave">
                  {tieneDetalle ? (
                    <span className="font-bold text-primario">{abierto ? '▾ Ocultar detalle' : '▸ Ver detalle'}</span>
                  ) : (
                    '—'
                  )}
                </span>
              </button>
              {abierto && tieneDetalle && (
                <div className="flex min-w-[900px] flex-wrap gap-3 px-5 pb-4">
                  <DetalleJson titulo="DATOS ANTERIORES" datos={r.datosAnteriores} />
                  <DetalleJson titulo="DATOS NUEVOS" datos={r.datosNuevos} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
