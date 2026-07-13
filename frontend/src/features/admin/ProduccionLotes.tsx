import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarLotes } from '../../api/produccion';
import { listarUsuarios } from '../../api/usuarios';
import { listarFichas } from '../../api/fichas';
import { fmtFecha, fmtNumero } from '../../lib/formato';

export function ProduccionLotes() {
  const lotes = useQuery({ queryKey: ['lotes'], queryFn: () => listarLotes() });
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: listarUsuarios });
  const fichas = useQuery({ queryKey: ['fichas'], queryFn: listarFichas });
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const nombreOperario = (id: number) => usuarios.data?.find((u) => u.id === id)?.nombre ?? `#${id}`;
  const versionDeFicha = (versionId: number) => {
    for (const f of fichas.data ?? []) {
      const v = f.versiones.find((v) => v.id === versionId);
      if (v) return `v${v.numeroVersion}`;
    }
    return '—';
  };

  function toggle(id: number) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-2xl font-extrabold">Producción — Lotes</h1>
        <div className="mt-1 text-sm text-texto-suave">Esperado vs. real, desvíos y trazabilidad completa.</div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid min-w-[1060px] grid-cols-[90px_110px_1fr_130px_90px_80px_90px_110px_80px_110px] gap-x-3 bg-chip px-4.5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>LOTE</span>
          <span>FECHA</span>
          <span>PRODUCTO</span>
          <span>OPERARIO</span>
          <span className="text-right">ESPERADO</span>
          <span className="text-right">REAL</span>
          <span className="text-right">DESVÍO</span>
          <span className="text-right">DESPERDICIO</span>
          <span>FICHA</span>
          <span />
        </div>
        {lotes.isLoading && <div className="px-4.5 py-4 text-texto-suave">Cargando…</div>}
        {lotes.data?.map((l) => {
          const desvio = l.desvioPct != null ? Number(l.desvioPct) : null;
          return (
            <div key={l.id} className="border-t border-[#eef1ea]">
              <div className="grid min-w-[1060px] grid-cols-[90px_110px_1fr_130px_90px_80px_90px_110px_80px_110px] items-center gap-x-3 px-4.5 py-3.5 text-sm">
                <span className="font-mono text-texto-suave">L-{l.id}</span>
                <span className="text-texto-suave">{fmtFecha(l.fechaHora)}</span>
                <span className="font-semibold">{l.productoElaborado}</span>
                <span>{nombreOperario(l.usuarioOperarioId)}</span>
                <span className="text-right">{l.unidadesEsperadas != null ? fmtNumero(l.unidadesEsperadas) : '—'}</span>
                <span className="text-right font-bold">{l.unidadesProducidasReales != null ? fmtNumero(l.unidadesProducidasReales) : '—'}</span>
                <span className="text-right font-extrabold" style={desvio != null && Math.abs(desvio) >= 10 ? { color: '#a02514' } : undefined}>
                  {desvio != null ? `${fmtNumero(desvio)} %` : '—'}
                </span>
                <span className="text-right text-texto-suave">{l.desperdicioRealKg != null ? fmtNumero(l.desperdicioRealKg) : '—'}</span>
                <span className="text-texto-suave">{versionDeFicha(l.fichaTecnicaVersionId)}</span>
                <button
                  type="button"
                  onClick={() => toggle(l.id)}
                  className="min-h-9 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-[13px] font-bold text-primario"
                >
                  {abiertos.has(l.id) ? 'Ocultar' : 'Ver'}
                </button>
              </div>
              {abiertos.has(l.id) && (
                <div className="flex flex-col gap-1.5 bg-[#f8faf5] px-4.5 py-3.5">
                  <div className="text-xs font-extrabold tracking-wide text-texto-suave">INSUMOS USADOS (TRAZABILIDAD)</div>
                  {l.insumosUsados?.map((i) => (
                    <div key={i.id} className="text-sm">
                      {i.productoInsumo?.nombre} — {fmtNumero(i.cantidadUsada)} {i.productoInsumo?.unidadDeMedida.toLowerCase()} ·
                      partida #{i.lineaIngresoOrigenId}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
