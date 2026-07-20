import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TecladoNumerico } from '../../../components/ui/TecladoNumerico';
import {
  CATEGORIAS_GASTO,
  MOTIVOS_ATENCION,
  marcarPollos,
  registrarAtencion,
  registrarCostoCero,
  registrarGasto,
  registrarRetiro,
} from '../../../api/caja';
import { listarProductos } from '../../../api/productos';
import { fmtMoneda } from '../../../lib/formato';
import { ApiError } from '../../../api/client';
import type { MedioPago, SocioRetiro } from '../../../api/types';

interface Props {
  sucursalId: number;
}

type Operacion = 'gasto' | 'retiro' | 'marcado' | 'costoCero' | 'atencion' | null;

const ETIQUETA_MOTIVO: Record<string, string> = {
  CLIENTE_FRECUENTE: 'Cliente frecuente',
  DEMORA: 'Demora en el pedido',
  ERROR_DEL_LOCAL: 'Error del local',
  CORTESIA: 'Cortesía',
  OTRO: 'Otro',
};

// Operaciones del turno (CLAUDE-MODULO-2.md §5.2 + §4.8/§4.9): gastos,
// retiros (selector CERRADO de socios), marcado de pollos, mermas/retornos
// y atenciones. Todo queda firmado por el usuario en sesión.
export function OperacionesCaja({ sucursalId }: Props) {
  const [operacion, setOperacion] = useState<Operacion>(null);
  const [exito, setExito] = useState<string | null>(null);

  const BOTONES: { op: Exclude<Operacion, null>; titulo: string; detalle: string; icono: string }[] = [
    { op: 'marcado', titulo: 'Tirar pollos a la parrilla', detalle: 'Del freezer a marcados', icono: '🔥' },
    { op: 'gasto', titulo: 'Gasto de caja', detalle: 'Papas, leña, limpieza…', icono: '🧾' },
    { op: 'retiro', titulo: 'Retiro de socio', detalle: 'Ariel, Eliana o Ema', icono: '💸' },
    { op: 'atencion', titulo: 'Atención / regalía', detalle: 'Producto sin cargo con motivo', icono: '🎁' },
    { op: 'costoCero', titulo: 'Quemado o retorno', detalle: 'Merma o vuelta a producción', icono: '♻️' },
  ];

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="text-[22px] font-extrabold">Caja</div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {BOTONES.map((b) => (
          <button
            key={b.op}
            type="button"
            onClick={() => setOperacion(b.op)}
            className="flex min-h-[92px] cursor-pointer items-center gap-4 rounded-2xl border border-borde bg-white px-5 text-left hover:border-primario"
          >
            <span className="text-4xl">{b.icono}</span>
            <span>
              <span className="block text-lg font-extrabold">{b.titulo}</span>
              <span className="block text-[15px] text-texto-suave">{b.detalle}</span>
            </span>
          </button>
        ))}
      </div>

      {operacion === 'gasto' && (
        <FormGasto sucursalId={sucursalId} onListo={(msj) => { setOperacion(null); setExito(msj); }} onCancelar={() => setOperacion(null)} />
      )}
      {operacion === 'retiro' && (
        <FormRetiro sucursalId={sucursalId} onListo={(msj) => { setOperacion(null); setExito(msj); }} onCancelar={() => setOperacion(null)} />
      )}
      {operacion === 'marcado' && (
        <FormMarcado sucursalId={sucursalId} onListo={(msj) => { setOperacion(null); setExito(msj); }} onCancelar={() => setOperacion(null)} />
      )}
      {operacion === 'costoCero' && (
        <FormCostoCero sucursalId={sucursalId} onListo={(msj) => { setOperacion(null); setExito(msj); }} onCancelar={() => setOperacion(null)} />
      )}
      {operacion === 'atencion' && (
        <FormAtencion sucursalId={sucursalId} onListo={(msj) => { setOperacion(null); setExito(msj); }} onCancelar={() => setOperacion(null)} />
      )}

      {exito && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
            <div className="text-xl font-extrabold">{exito} ✓</div>
            <button
              type="button"
              onClick={() => setExito(null)}
              className="mt-1 min-h-[56px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white"
            >
              LISTO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Marco común de los formularios (modal) ──
function Modal({ titulo, children, onCancelar }: { titulo: string; children: React.ReactNode; onCancelar: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div className="flex max-h-[92vh] w-full flex-col gap-3.5 overflow-auto rounded-t-3xl bg-white p-5 sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <div className="text-xl font-extrabold">{titulo}</div>
          <button
            type="button"
            onClick={onCancelar}
            className="cursor-pointer rounded-lg border border-borde-fuerte px-3 py-1.5 text-sm font-bold text-texto-suave"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BotonConfirmar({ deshabilitado, pendiente, texto, onClick }: { deshabilitado: boolean; pendiente: boolean; texto: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={deshabilitado || pendiente}
      onClick={onClick}
      className="min-h-[60px] w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
    >
      {pendiente ? 'REGISTRANDO…' : texto}
    </button>
  );
}

function MensajeError({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">{texto}</div>;
}

function chips(activo: boolean) {
  return `min-h-[50px] cursor-pointer rounded-xl px-4 text-[15px] font-bold ${
    activo ? 'bg-primario text-white' : 'border border-borde-fuerte bg-white text-texto-suave'
  }`;
}

// ── Gasto ──
function FormGasto({ sucursalId, onListo, onCancelar }: { sucursalId: number; onListo: (msj: string) => void; onCancelar: () => void }) {
  const [monto, setMonto] = useState<number | null>(null);
  const [medio, setMedio] = useState<'EFECTIVO' | 'MERCADO_PAGO'>('EFECTIVO');
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_GASTO[0]);
  const [descripcion, setDescripcion] = useState('');
  const [tecladoAbierto, setTecladoAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      registrarGasto({
        sucursalId,
        monto: monto!,
        medio,
        categoria,
        descripcion: descripcion.trim() || undefined,
      }),
    onSuccess: () => onListo('Gasto registrado'),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar.'),
  });

  return (
    <Modal titulo="Gasto de caja" onCancelar={onCancelar}>
      <button
        type="button"
        onClick={() => setTecladoAbierto(true)}
        className="min-h-[64px] cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-panel px-4 text-right text-3xl font-extrabold"
      >
        {monto != null ? fmtMoneda(monto) : 'Cargar monto'}
      </button>
      <div className="flex gap-2">
        {(['EFECTIVO', 'MERCADO_PAGO'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMedio(m)} className={chips(medio === m)}>
            {m === 'EFECTIVO' ? 'Efectivo' : 'MP'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {CATEGORIAS_GASTO.map((c) => (
          <button key={c} type="button" onClick={() => setCategoria(c)} className={chips(categoria === c)}>
            {c}
          </button>
        ))}
      </div>
      {categoria === 'OTRO' && (
        <input
          type="text"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="¿En qué se gastó?"
          className="min-h-[52px] rounded-xl border-2 border-borde-fuerte px-4 text-base"
        />
      )}
      <MensajeError texto={error} />
      <BotonConfirmar
        deshabilitado={monto == null || (categoria === 'OTRO' && !descripcion.trim())}
        pendiente={mut.isPending}
        texto="REGISTRAR GASTO"
        onClick={() => {
          setError(null);
          mut.mutate();
        }}
      />
      {tecladoAbierto && (
        <TecladoNumerico
          titulo="¿Cuánto se gastó?"
          unidad="$"
          permiteDecimal
          onCancelar={() => setTecladoAbierto(false)}
          onConfirmar={(v) => {
            setMonto(v);
            setTecladoAbierto(false);
          }}
        />
      )}
    </Modal>
  );
}

// ── Retiro (selector CERRADO de socios — sin cuarta opción) ──
function FormRetiro({ sucursalId, onListo, onCancelar }: { sucursalId: number; onListo: (msj: string) => void; onCancelar: () => void }) {
  const [monto, setMonto] = useState<number | null>(null);
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [socio, setSocio] = useState<SocioRetiro | null>(null);
  const [tecladoAbierto, setTecladoAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => registrarRetiro({ sucursalId, monto: monto!, medio, socio: socio! }),
    onSuccess: () => onListo('Retiro registrado'),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar.'),
  });

  return (
    <Modal titulo="Retiro de socio" onCancelar={onCancelar}>
      <div className="text-[15px] font-bold text-texto-suave">¿Quién retira?</div>
      <div className="flex gap-2">
        {(['ARIEL', 'ELIANA', 'EMA'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSocio(s)} className={`flex-1 ${chips(socio === s)}`}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTecladoAbierto(true)}
        className="min-h-[64px] cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-panel px-4 text-right text-3xl font-extrabold"
      >
        {monto != null ? fmtMoneda(monto) : 'Cargar monto'}
      </button>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['EFECTIVO', 'Efectivo'],
            ['MERCADO_PAGO', 'MP'],
            ['TRANSFERENCIA', 'Transferencia'],
            ['DEBITO', 'Débito'],
            ['CREDITO', 'Crédito'],
          ] as const
        ).map(([m, etiqueta]) => (
          <button key={m} type="button" onClick={() => setMedio(m)} className={chips(medio === m)}>
            {etiqueta}
          </button>
        ))}
      </div>
      <MensajeError texto={error} />
      <BotonConfirmar
        deshabilitado={monto == null || socio == null}
        pendiente={mut.isPending}
        texto="REGISTRAR RETIRO"
        onClick={() => {
          setError(null);
          mut.mutate();
        }}
      />
      {tecladoAbierto && (
        <TecladoNumerico
          titulo="¿Cuánto retira?"
          unidad="$"
          permiteDecimal
          onCancelar={() => setTecladoAbierto(false)}
          onConfirmar={(v) => {
            setMonto(v);
            setTecladoAbierto(false);
          }}
        />
      )}
    </Modal>
  );
}

// ── Marcado de pollos (fresco → parrilla) ──
function FormMarcado({ sucursalId, onListo, onCancelar }: { sucursalId: number; onListo: (msj: string) => void; onCancelar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (cantidad: number) => marcarPollos({ sucursalId, cantidad }),
    onSuccess: () => onListo('Pollos marcados'),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar.'),
  });

  return (
    <>
      <TecladoNumerico
        titulo="¿Cuántos pollos tiraste a la parrilla?"
        subtitulo="Salen del freezer y pasan a marcados"
        unidad="u"
        permiteDecimal={false}
        onCancelar={onCancelar}
        onConfirmar={(v) => {
          setError(null);
          mut.mutate(v);
        }}
      />
      {error && (
        <div className="fixed inset-x-4 top-4 z-30 rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto shadow-lg">
          {error}
        </div>
      )}
    </>
  );
}

// ── Selector de producto compartido (atención / costo cero) ──
function SelectorProducto({
  valor,
  onCambiar,
  incluirMateriaPrima,
}: {
  valor: number | null;
  onCambiar: (id: number) => void;
  incluirMateriaPrima?: boolean;
}) {
  const productosQ = useQuery({ queryKey: ['productos'], queryFn: () => listarProductos({ activo: true }) });
  const opciones = (productosQ.data ?? []).filter(
    (p) => incluirMateriaPrima || p.tipo !== 'MATERIA_PRIMA',
  );
  return (
    <select
      value={valor ?? ''}
      onChange={(e) => onCambiar(Number(e.target.value))}
      className="min-h-[52px] rounded-xl border-2 border-borde-fuerte bg-white px-3 text-base font-semibold"
    >
      <option value="" disabled>
        Elegí el producto…
      </option>
      {opciones.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nombre}
        </option>
      ))}
    </select>
  );
}

// ── Atención / regalía (§4.8) ──
function FormAtencion({ sucursalId, onListo, onCancelar }: { sucursalId: number; onListo: (msj: string) => void; onCancelar: () => void }) {
  const queryClient = useQueryClient();
  const [productoId, setProductoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState<string>(MOTIVOS_ATENCION[0]);
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      registrarAtencion({
        sucursalId,
        productoId: productoId!,
        cantidad,
        motivoCodigo: motivo,
        motivoDetalle: detalle.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onListo('Atención registrada');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar.'),
  });

  return (
    <Modal titulo="Atención / regalía" onCancelar={onCancelar}>
      <SelectorProducto valor={productoId} onCambiar={setProductoId} />
      <div className="flex items-center gap-3">
        <span className="text-[15px] font-bold text-texto-suave">Cantidad</span>
        <button
          type="button"
          onClick={() => setCantidad((c) => Math.max(1, c - 1))}
          className="h-12 w-12 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-xl font-bold"
        >
          −
        </button>
        <span className="min-w-8 text-center text-xl font-extrabold">{cantidad}</span>
        <button
          type="button"
          onClick={() => setCantidad((c) => c + 1)}
          className="h-12 w-12 cursor-pointer rounded-lg border border-borde-fuerte bg-white text-xl font-bold"
        >
          +
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {MOTIVOS_ATENCION.map((m) => (
          <button key={m} type="button" onClick={() => setMotivo(m)} className={chips(motivo === m)}>
            {ETIQUETA_MOTIVO[m]}
          </button>
        ))}
      </div>
      {motivo === 'OTRO' && (
        <input
          type="text"
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          placeholder="¿Por qué se regala?"
          className="min-h-[52px] rounded-xl border-2 border-borde-fuerte px-4 text-base"
        />
      )}
      <MensajeError texto={error} />
      <BotonConfirmar
        deshabilitado={productoId == null || (motivo === 'OTRO' && !detalle.trim())}
        pendiente={mut.isPending}
        texto="REGISTRAR ATENCIÓN"
        onClick={() => {
          setError(null);
          mut.mutate();
        }}
      />
    </Modal>
  );
}

// ── Costo cero: quemado / retorno a producción (§4.9) ──
function FormCostoCero({ sucursalId, onListo, onCancelar }: { sucursalId: number; onListo: (msj: string) => void; onCancelar: () => void }) {
  const queryClient = useQueryClient();
  const [productoId, setProductoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const [tipo, setTipo] = useState<'DESPERDICIO_QUEMADO' | 'RETORNO_A_PRODUCCION'>('DESPERDICIO_QUEMADO');
  const [motivoTexto, setMotivoTexto] = useState('');
  const [tecladoAbierto, setTecladoAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      registrarCostoCero({
        sucursalId,
        productoId: productoId!,
        cantidad: cantidad!,
        tipo,
        motivo: motivoTexto.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onListo(tipo === 'DESPERDICIO_QUEMADO' ? 'Merma registrada' : 'Retorno registrado');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar.'),
  });

  return (
    <Modal titulo="Quemado o retorno a producción" onCancelar={onCancelar}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTipo('DESPERDICIO_QUEMADO')}
          className={`flex-1 ${chips(tipo === 'DESPERDICIO_QUEMADO')}`}
        >
          🔥 Se quemó / se tira
        </button>
        <button
          type="button"
          onClick={() => setTipo('RETORNO_A_PRODUCCION')}
          className={`flex-1 ${chips(tipo === 'RETORNO_A_PRODUCCION')}`}
        >
          ♻️ Vuelve a producción
        </button>
      </div>
      <SelectorProducto valor={productoId} onCambiar={setProductoId} />
      <button
        type="button"
        onClick={() => setTecladoAbierto(true)}
        className="min-h-[56px] cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-panel px-4 text-right text-2xl font-extrabold"
      >
        {cantidad != null ? `${cantidad} u` : 'Cargar cantidad'}
      </button>
      <input
        type="text"
        value={motivoTexto}
        onChange={(e) => setMotivoTexto(e.target.value)}
        placeholder="Motivo (opcional)"
        className="min-h-[52px] rounded-xl border-2 border-borde-fuerte px-4 text-base"
      />
      <MensajeError texto={error} />
      <BotonConfirmar
        deshabilitado={productoId == null || cantidad == null}
        pendiente={mut.isPending}
        texto="REGISTRAR"
        onClick={() => {
          setError(null);
          mut.mutate();
        }}
      />
      {tecladoAbierto && (
        <TecladoNumerico
          titulo="¿Qué cantidad?"
          subtitulo="Medio pollo marcado = 0,5"
          unidad="u"
          permiteDecimal
          onCancelar={() => setTecladoAbierto(false)}
          onConfirmar={(v) => {
            setCantidad(v);
            setTecladoAbierto(false);
          }}
        />
      )}
    </Modal>
  );
}
