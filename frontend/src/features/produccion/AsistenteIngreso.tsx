import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EncabezadoWizard } from '../../components/ui/EncabezadoWizard';
import { Selector, type ItemSelector } from '../../components/ui/Selector';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { PantallaExito } from '../../components/ui/PantallaExito';
import { listarProveedores } from '../../api/proveedores';
import { listarProductos } from '../../api/productos';
import { registrarIngreso, subirFotoRemito } from '../../api/ingresos';
import { ApiError } from '../../api/client';
import { fmtNumero } from '../../lib/formato';
import type { Producto, Proveedor } from '../../api/types';

interface Props {
  onVolver: () => void;
  onFinalizado: () => void;
}

interface LineaIngresoUI {
  producto: Producto;
  cantidadSegunRemito: number;
  cantidadRealPesada: number;
}

type Overlay =
  | { tipo: 'selectorProducto' }
  | { tipo: 'tecladoRemito'; producto: Producto }
  | { tipo: 'tecladoPesada'; producto: Producto; remito: number }
  | null;

export function AsistenteIngreso({ onVolver, onFinalizado }: Props) {
  const [paso, setPaso] = useState(1);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [comentarioOtro, setComentarioOtro] = useState('');
  const [lineas, setLineas] = useState<LineaIngresoUI[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoNombre, setFotoNombre] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  const proveedores = useQuery({ queryKey: ['proveedores'], queryFn: listarProveedores });
  const materiasPrimas = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA', activo: true }),
  });

  const mutSubirFoto = useMutation({
    mutationFn: subirFotoRemito,
    onSuccess: (data, archivo) => {
      setFotoUrl(data.fotoRemitoUrl);
      setFotoNombre(archivo.name);
      setSubiendoFoto(false);
    },
    onError: () => setSubiendoFoto(false),
  });

  const mutConfirmar = useMutation({
    mutationFn: registrarIngreso,
    onSuccess: () => setExito(true),
    onError: (err) => setErrorEnvio(err instanceof ApiError ? err.message : 'No se pudo registrar el ingreso.'),
  });

  if (exito) {
    return (
      <PantallaExito
        titulo="Ingreso registrado"
        subtitulo={`${lineas.length} producto${lineas.length === 1 ? '' : 's'} cargado${lineas.length === 1 ? '' : 's'}.`}
        onContinuar={onFinalizado}
      />
    );
  }

  function volver() {
    if (paso === 1) return onVolver();
    setPaso((p) => p - 1);
  }

  const itemsProveedores: ItemSelector[] =
    proveedores.data?.map((p) => ({ id: p.id, label: p.esOtro ? 'OTRO' : p.nombre })) ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <EncabezadoWizard titulo="Llegó mercadería" paso={paso} totalPasos={4} onVolver={volver} />

      {paso === 1 && (
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">¿De dónde vino?</div>
          {proveedores.isLoading && <div className="text-texto-suave">Cargando proveedores…</div>}
          {itemsProveedores.map((item) => {
            const p = proveedores.data!.find((x) => x.id === item.id)!;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProveedor(p)}
                className={`min-h-[58px] w-full cursor-pointer rounded-2xl border-2 px-4.5 py-3.5 text-left text-lg font-bold hover:border-primario ${
                  proveedor?.id === p.id ? 'border-primario bg-primario-suave' : 'border-borde bg-white'
                }`}
              >
                {p.esOtro ? 'OTRO' : p.nombre}
              </button>
            );
          })}
          {proveedor?.esOtro && (
            <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-primario bg-white p-4">
              <label htmlFor="otroprov" className="text-base font-bold">
                ¿De dónde vino? (obligatorio)
              </label>
              <input
                id="otroprov"
                value={comentarioOtro}
                onChange={(e) => setComentarioOtro(e.target.value)}
                placeholder="Escribí el nombre…"
                className="h-14 rounded-xl border-2 border-borde-fuerte px-3.5 text-lg outline-primario"
              />
              <button
                type="button"
                disabled={!comentarioOtro.trim()}
                onClick={() => setPaso(2)}
                className="min-h-14 w-full cursor-pointer rounded-xl bg-primario text-lg font-bold text-white disabled:opacity-50"
              >
                CONTINUAR
              </button>
            </div>
          )}
          {proveedor && !proveedor.esOtro && (
            <button
              type="button"
              onClick={() => setPaso(2)}
              className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
            >
              CONTINUAR
            </button>
          )}
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Productos del remito</div>
          <div className="text-[15px] text-texto-suave">Cargá lo que dice el remito y lo que pesaste vos.</div>
          {lineas.map((l, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-bold">{l.producto.nombre}</div>
                <div className="text-sm text-texto-suave">
                  Remito: {fmtNumero(l.cantidadSegunRemito)} {l.producto.unidadDeMedida.toLowerCase()} · Pesado:{' '}
                  {fmtNumero(l.cantidadRealPesada)} {l.producto.unidadDeMedida.toLowerCase()}
                </div>
              </div>
              <button
                type="button"
                aria-label="Borrar"
                onClick={() => setLineas((ls) => ls.filter((_, idx) => idx !== i))}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-red-200 bg-white text-lg font-bold text-error hover:bg-error-suave"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOverlay({ tipo: 'selectorProducto' })}
            className="min-h-[62px] w-full cursor-pointer rounded-2xl border-2 border-dashed border-borde-fuerte bg-transparent text-lg font-bold text-primario hover:bg-chip"
          >
            ＋ AGREGAR PRODUCTO
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={lineas.length === 0}
            onClick={() => setPaso(3)}
            className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white disabled:opacity-50"
          >
            CONTINUAR
          </button>
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Foto del remito</div>
          <div className="text-[15px] text-texto-suave">Es opcional. Si podés, sacale una foto.</div>
          {fotoUrl && (
            <div className="flex items-center gap-3.5 rounded-2xl border-2 border-primario bg-white p-4.5">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-borde-fuerte bg-chip text-[10px] text-texto-suave">
                foto
              </div>
              <div className="flex-1">
                <div className="text-base font-bold text-primario">✓ Foto cargada</div>
                <div className="text-sm text-texto-suave">{fotoNombre}</div>
              </div>
            </div>
          )}
          <input
            ref={inputFotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              if (archivo) {
                setSubiendoFoto(true);
                mutSubirFoto.mutate(archivo);
              }
            }}
          />
          <button
            type="button"
            disabled={subiendoFoto}
            onClick={() => inputFotoRef.current?.click()}
            className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-primario bg-white text-lg font-extrabold text-primario hover:bg-chip disabled:opacity-50"
          >
            {subiendoFoto ? 'SUBIENDO…' : 'SACAR FOTO DEL REMITO'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaso(4)}
            className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
          >
            {fotoUrl ? 'CONTINUAR' : 'SALTEAR'}
          </button>
        </div>
      )}

      {paso === 4 && (
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-5 pt-1.5">
          <div className="py-1 text-xl font-extrabold">Revisá antes de confirmar</div>
          <div className="flex flex-col gap-2.5 rounded-2xl border border-borde bg-white p-4">
            <div className="flex justify-between gap-2.5">
              <span className="text-[15px] text-texto-suave">Proveedor</span>
              <span className="text-right text-base font-bold">
                {proveedor?.esOtro ? comentarioOtro : proveedor?.nombre}
              </span>
            </div>
            <div className="flex justify-between gap-2.5">
              <span className="text-[15px] text-texto-suave">Foto del remito</span>
              <span className="text-base font-bold">{fotoUrl ? 'Sí' : 'No'}</span>
            </div>
          </div>
          {lineas.map((l, i) => (
            <div key={i} className="rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="text-[17px] font-bold">{l.producto.nombre}</div>
              <div className="text-sm text-texto-suave">
                Remito: {fmtNumero(l.cantidadSegunRemito)} {l.producto.unidadDeMedida.toLowerCase()} · Pesado:{' '}
                {fmtNumero(l.cantidadRealPesada)} {l.producto.unidadDeMedida.toLowerCase()}
              </div>
            </div>
          ))}
          {errorEnvio && (
            <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">
              {errorEnvio}
            </div>
          )}
          <div className="flex-1" />
          <button
            type="button"
            disabled={mutConfirmar.isPending}
            onClick={() => {
              setErrorEnvio(null);
              mutConfirmar.mutate({
                proveedorId: proveedor!.id,
                comentarioProveedorOtro: proveedor?.esOtro ? comentarioOtro : undefined,
                fotoRemitoUrl: fotoUrl ?? undefined,
                lineas: lineas.map((l) => ({
                  productoId: l.producto.id,
                  cantidadSegunRemito: l.cantidadSegunRemito,
                  cantidadRealPesada: l.cantidadRealPesada,
                })),
              });
            }}
            className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-xl font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {mutConfirmar.isPending ? 'CONFIRMANDO…' : 'CONFIRMAR INGRESO'}
          </button>
        </div>
      )}

      {overlay?.tipo === 'selectorProducto' && (
        <Selector
          titulo="Elegí el producto"
          buscable
          items={(materiasPrimas.data ?? []).map((p) => ({ id: p.id, label: p.nombre }))}
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const producto = materiasPrimas.data!.find((p) => p.id === item.id)!;
            setOverlay({ tipo: 'tecladoRemito', producto });
          }}
        />
      )}

      {overlay?.tipo === 'tecladoRemito' && (
        <TecladoNumerico
          titulo="¿Cuánto dice el remito?"
          subtitulo={overlay.producto.nombre}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(remito) => setOverlay({ tipo: 'tecladoPesada', producto: overlay.producto, remito })}
        />
      )}

      {overlay?.tipo === 'tecladoPesada' && (
        <TecladoNumerico
          titulo="¿Cuánto pesaste vos?"
          subtitulo={overlay.producto.nombre}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(pesada) => {
            setLineas((ls) => [
              ...ls,
              { producto: overlay.producto, cantidadSegunRemito: overlay.remito, cantidadRealPesada: pesada },
            ]);
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
