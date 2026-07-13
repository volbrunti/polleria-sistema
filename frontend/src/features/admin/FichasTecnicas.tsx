import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarFichas, crearFicha, crearNuevaVersion, type VersionInput } from '../../api/fichas';
import { listarProductos } from '../../api/productos';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtNumero } from '../../lib/formato';

interface Props {
  puedeEscribir: boolean;
}

interface IngredienteForm {
  productoInsumoId: number | '';
  cantidad: string;
}

type ModoFormulario = { modo: 'nueva' } | { modo: 'version'; fichaId: number; productoNombre: string } | null;

function formularioVacio(): { rendimiento: string; desperdicio: string; umbral: string; productoElaboradoId: number | ''; ingredientes: IngredienteForm[]; principal: number } {
  return {
    rendimiento: '',
    desperdicio: '',
    umbral: '',
    productoElaboradoId: '',
    ingredientes: [{ productoInsumoId: '', cantidad: '' }],
    principal: 0,
  };
}

export function FichasTecnicas({ puedeEscribir }: Props) {
  const queryClient = useQueryClient();
  const fichas = useQuery({ queryKey: ['fichas'], queryFn: listarFichas });
  const elaborados = useQuery({
    queryKey: ['productos', 'ELABORADO'],
    queryFn: () => listarProductos({ tipo: 'ELABORADO' }),
  });
  const insumos = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA' }),
  });

  const [formularioAbierto, setFormularioAbierto] = useState<ModoFormulario>(null);
  const [form, setForm] = useState(formularioVacio());
  const [error, setError] = useState<string | null>(null);

  const idsConFicha = new Set(fichas.data?.map((f) => f.productoElaboradoId));
  const elaboradosSinFicha = elaborados.data?.filter((p) => !idsConFicha.has(p.id)) ?? [];

  function cerrarFormulario() {
    setFormularioAbierto(null);
    setForm(formularioVacio());
    setError(null);
  }

  const mutCrearFicha = useMutation({
    mutationFn: (vars: { productoElaboradoId: number; version: VersionInput }) =>
      crearFicha(vars.productoElaboradoId, vars.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fichas'] });
      cerrarFormulario();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar la ficha.'),
  });

  const mutNuevaVersion = useMutation({
    mutationFn: (vars: { fichaId: number; version: VersionInput }) => crearNuevaVersion(vars.fichaId, vars.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fichas'] });
      cerrarFormulario();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar la versión.'),
  });

  function validarYConstruir(): VersionInput | null {
    const rendimiento = parseFloat(form.rendimiento.replace(',', '.'));
    const desperdicio = parseFloat(form.desperdicio.replace(',', '.'));
    const umbral = parseFloat(form.umbral.replace(',', '.'));
    if (!rendimiento || rendimiento <= 0) return setError('Cargá un rendimiento esperado válido.'), null;
    if (Number.isNaN(desperdicio) || desperdicio < 0 || desperdicio > 100) return setError('El % de desperdicio debe estar entre 0 y 100.'), null;
    if (Number.isNaN(umbral) || umbral < 0 || umbral > 100) return setError('El umbral de alerta debe estar entre 0 y 100.'), null;
    if (form.ingredientes.some((i) => !i.productoInsumoId || !i.cantidad)) return setError('Completá todos los ingredientes.'), null;
    setError(null);
    return {
      rendimientoEsperado: rendimiento,
      desperdicioEsperadoPct: desperdicio,
      umbralDesvioAlertaPct: umbral,
      ingredientes: form.ingredientes.map((i, idx) => ({
        productoInsumoId: Number(i.productoInsumoId),
        cantidadPorUnidadProducida: parseFloat(i.cantidad.replace(',', '.')),
        esPrincipal: idx === form.principal,
      })),
    };
  }

  function guardar() {
    const version = validarYConstruir();
    if (!version || !formularioAbierto) return;
    if (formularioAbierto.modo === 'nueva') {
      if (!form.productoElaboradoId) return setError('Elegí el producto.');
      mutCrearFicha.mutate({ productoElaboradoId: Number(form.productoElaboradoId), version });
    } else {
      mutNuevaVersion.mutate({ fichaId: formularioAbierto.fichaId, version });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5">
        <div className="flex-1">
          <h1 className="m-0 text-2xl font-extrabold">Fichas técnicas</h1>
          <div className="mt-1 text-sm text-texto-suave">Recetas con versión. La versión nueva desactiva la anterior.</div>
        </div>
        {puedeEscribir && (
          <button
            type="button"
            onClick={() => setFormularioAbierto({ modo: 'nueva' })}
            className="min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
          >
            ＋ NUEVA FICHA
          </button>
        )}
      </div>

      {formularioAbierto && (
        <div className="flex flex-col gap-3.5 rounded-2xl border-2 border-primario bg-white p-5">
          <div className="text-[17px] font-extrabold">
            {formularioAbierto.modo === 'nueva' ? 'Nueva ficha técnica' : `Nueva versión — ${formularioAbierto.productoNombre}`}
          </div>
          {formularioAbierto.modo === 'version' && (
            <div className="rounded-xl bg-[#fff7d9] px-3.5 py-3 text-sm font-semibold text-advertencia-texto">
              Ojo: al guardar, la versión anterior de esta ficha queda desactivada.
            </div>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            {formularioAbierto.modo === 'nueva' && (
              <div>
                <label className="mb-1 block text-[13px] font-semibold">Producto</label>
                <select
                  value={form.productoElaboradoId}
                  onChange={(e) => setForm((f) => ({ ...f, productoElaboradoId: Number(e.target.value) }))}
                  className="h-11.5 w-full rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
                >
                  <option value="">Elegir…</option>
                  {elaboradosSinFicha.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-[13px] font-semibold">Rendimiento esperado (u / kg del principal)</label>
              <input
                value={form.rendimiento}
                onChange={(e) => setForm((f) => ({ ...f, rendimiento: e.target.value }))}
                className="h-11.5 w-full rounded-[10px] border border-borde-fuerte px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-semibold">% desperdicio esperado</label>
              <input
                value={form.desperdicio}
                onChange={(e) => setForm((f) => ({ ...f, desperdicio: e.target.value }))}
                className="h-11.5 w-full rounded-[10px] border border-borde-fuerte px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-semibold">Umbral de alerta (%)</label>
              <input
                value={form.umbral}
                onChange={(e) => setForm((f) => ({ ...f, umbral: e.target.value }))}
                className="h-11.5 w-full rounded-[10px] border border-borde-fuerte px-3 text-sm"
              />
            </div>
          </div>

          <div className="text-[13px] font-semibold">Ingredientes (marcá cuál es el principal — exactamente uno)</div>
          {form.ingredientes.map((ing, idx) => (
            <div key={idx} className="flex items-center gap-2.5">
              <input
                type="radio"
                name="principal"
                checked={form.principal === idx}
                onChange={() => setForm((f) => ({ ...f, principal: idx }))}
                className="h-5 w-5"
              />
              <select
                value={ing.productoInsumoId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ingredientes: f.ingredientes.map((x, i) => (i === idx ? { ...x, productoInsumoId: Number(e.target.value) } : x)),
                  }))
                }
                className="h-11.5 flex-[2] rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
              >
                <option value="">Ingrediente…</option>
                {insumos.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <input
                placeholder="Cantidad por unidad"
                value={ing.cantidad}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ingredientes: f.ingredientes.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)),
                  }))
                }
                className="h-11.5 flex-1 rounded-[10px] border border-borde-fuerte px-3 text-sm"
              />
              {form.ingredientes.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      ingredientes: f.ingredientes.filter((_, i) => i !== idx),
                      principal: f.principal === idx ? 0 : f.principal > idx ? f.principal - 1 : f.principal,
                    }))
                  }
                  className="flex h-11.5 w-11.5 cursor-pointer items-center justify-center rounded-[10px] border border-red-200 bg-white text-error"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, ingredientes: [...f.ingredientes, { productoInsumoId: '', cantidad: '' }] }))}
            className="w-fit cursor-pointer text-sm font-bold text-primario"
          >
            ＋ Agregar ingrediente
          </button>

          {error && <div className="rounded-xl bg-error-suave px-3.5 py-3 text-sm font-semibold text-error-texto">{error}</div>}

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={cerrarFormulario}
              className="min-h-12 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4.5 text-[15px] font-bold text-texto-suave"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={mutCrearFicha.isPending || mutNuevaVersion.isPending}
              onClick={guardar}
              className="min-h-12 cursor-pointer rounded-xl bg-primario px-5.5 text-[15px] font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR VERSIÓN
            </button>
          </div>
        </div>
      )}

      {fichas.isLoading && <div className="text-texto-suave">Cargando…</div>}

      {fichas.data?.map((f) => {
        const activa = f.versiones.find((v) => v.activa);
        const anteriores = f.versiones.filter((v) => !v.activa);
        return (
          <div key={f.id} className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 text-lg font-extrabold">{f.productoElaborado?.nombre}</div>
              {activa && (
                <span className="rounded-lg bg-primario-suave px-2.5 py-1.5 text-[13px] font-extrabold text-primario">
                  v{activa.numeroVersion} · ACTIVA
                </span>
              )}
              {puedeEscribir && activa && (
                <button
                  type="button"
                  onClick={() => setFormularioAbierto({ modo: 'version', fichaId: f.id, productoNombre: f.productoElaborado?.nombre ?? '' })}
                  className="min-h-10.5 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-3.5 text-sm font-bold text-primario"
                >
                  Nueva versión
                </button>
              )}
            </div>
            {activa && (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-4.5 gap-y-2.5">
                  <div>
                    <div className="text-xs font-semibold text-texto-suave">Rendimiento esperado</div>
                    <div className="text-[15px] font-bold">{fmtNumero(activa.rendimientoEsperado)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-texto-suave">% desperdicio esperado</div>
                    <div className="text-[15px] font-bold">{fmtNumero(activa.desperdicioEsperadoPct)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-texto-suave">Umbral de alerta</div>
                    <div className="text-[15px] font-bold">{fmtNumero(activa.umbralDesvioAlertaPct)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-texto-suave">Versiones anteriores</div>
                    <div className="text-[15px] font-bold text-texto-suave">
                      {anteriores.length > 0 ? anteriores.map((v) => `v${v.numeroVersion} (${fmtFecha(v.fechaDesde)})`).join(', ') : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-[#eef1ea] pt-2.5">
                  {activa.ingredientes.map((i) => (
                    <span key={i.id} className="rounded-lg border border-borde bg-panel px-3 py-1.5 text-sm font-semibold">
                      {i.productoInsumo?.nombre} — {fmtNumero(i.cantidadPorUnidadProducida)} {i.productoInsumo?.unidadDeMedida.toLowerCase()}
                      {i.esPrincipal ? ' (principal)' : ''}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
