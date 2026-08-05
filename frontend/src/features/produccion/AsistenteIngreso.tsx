import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EncabezadoWizard } from '../../components/ui/EncabezadoWizard';
import { Selector, type ItemSelector } from '../../components/ui/Selector';
import { TecladoNumerico } from '../../components/ui/TecladoNumerico';
import { PantallaExito } from '../../components/ui/PantallaExito';
import { listarProveedores, productosHabituales } from '../../api/proveedores';
import { listarProductos } from '../../api/productos';
import { registrarIngreso, subirFotoRemito, lineasDisponibles } from '../../api/ingresos';
import { ApiError } from '../../api/client';
import { fmtFecha, fmtNumero } from '../../lib/formato';
import type { LineaIngresoDisponible, Producto, Proveedor } from '../../api/types';

interface Props {
  onVolver: () => void;
  onFinalizado: () => void;
  /** Atajo desde la pantalla de éxito: lo que entró casi siempre se produce. */
  onIrAProducir?: () => void;
}

interface LineaIngresoUI {
  producto: Producto;
  cantidadSegunRemito: number;
  cantidadRealPesada: number;
  /** Partidas de este producto que TODAVÍA tienen saldo cuando llega la nueva. */
  saldoPrevio: LineaIngresoDisponible[];
}

type Overlay =
  | { tipo: 'selectorProducto' }
  | { tipo: 'buscandoSaldo'; producto: Producto }
  | { tipo: 'tecladoRemito'; producto: Producto; saldoPrevio: LineaIngresoDisponible[] }
  | { tipo: 'tecladoPesada'; producto: Producto; remito: number; saldoPrevio: LineaIngresoDisponible[] }
  | null;

// "Todavía te queda de antes". Ariel lo pidió con estas palabras: "que me
// salte una alerta en rojo, acordate que te quedan dos kilos de esta". El caso
// real que lo motivó es la bolsita olvidada en el fondo de la heladera.
function AvisoSaldoPrevio({ producto, saldo }: { producto: Producto; saldo: LineaIngresoDisponible[] }) {
  if (saldo.length === 0) return null;
  const u = producto.unidadDeMedida.toLowerCase();
  const total = saldo.reduce((acc, l) => acc + Number(l.cantidadRestanteDisponible), 0);
  return (
    <div className="rounded-xl border-2 border-error bg-error-suave px-3.5 py-2.5">
      <div className="text-[15px] font-extrabold text-error-texto">
        ⚠️ Ojo: todavía te quedan {fmtNumero(total)} {u} de antes
      </div>
      <div className="mt-1 flex flex-col gap-0.5 text-sm font-semibold text-error-texto">
        {saldo.map((l) => (
          <div key={l.id}>
            · Partida del {l.ingresoMercaderia ? fmtFecha(l.ingresoMercaderia.fechaHora) : '?'}:{' '}
            {fmtNumero(l.cantidadRestanteDisponible)} {u}
          </div>
        ))}
      </div>
    </div>
  );
}

// Remito vs pesado, con la diferencia destacada cuando no coinciden. Es el
// dato que justifica todo el flujo: Ariel contó que pesando bolsas de papa
// "de 10 kg" descubrió que el promedio real era 9,750.
function DetalleLinea({ linea }: { linea: LineaIngresoUI }) {
  const u = linea.producto.unidadDeMedida.toLowerCase();
  const diferencia = linea.cantidadRealPesada - linea.cantidadSegunRemito;
  const coincide = Math.abs(diferencia) < 0.0005;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-texto-suave">
      <span>
        Remito: {fmtNumero(linea.cantidadSegunRemito)} {u}
      </span>
      <span aria-hidden>·</span>
      <span>
        Pesado: {fmtNumero(linea.cantidadRealPesada)} {u}
      </span>
      {!coincide && (
        <span className="rounded-md bg-advertencia-suave px-2 py-0.5 text-[13px] font-extrabold text-advertencia-texto">
          {diferencia > 0 ? '+' : '−'}
          {fmtNumero(Math.abs(diferencia))} {u}
        </span>
      )}
    </div>
  );
}

export function AsistenteIngreso({ onVolver, onFinalizado, onIrAProducir }: Props) {
  const [paso, setPaso] = useState(1);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [comentarioOtro, setComentarioOtro] = useState('');
  const [lineas, setLineas] = useState<LineaIngresoUI[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoNombre, setFotoNombre] = useState<string | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  const proveedores = useQuery({ queryKey: ['proveedores'], queryFn: listarProveedores });
  const materiasPrimas = useQuery({
    queryKey: ['productos', 'MATERIA_PRIMA'],
    queryFn: () => listarProductos({ tipo: 'MATERIA_PRIMA', activo: true }),
  });
  // Accesos rápidos: qué le suele comprar la pollería a este proveedor (sin
  // cantidades — eso se sigue cargando en el momento). Lo configura el admin.
  const habituales = useQuery({
    queryKey: ['proveedores', proveedor?.id, 'productos-habituales'],
    queryFn: () => productosHabituales(proveedor!.id),
    enabled: proveedor != null && !proveedor.esOtro,
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
        accionSugerida={onIrAProducir ? { texto: 'AHORA PRODUCIR →', onClick: onIrAProducir } : undefined}
      />
    );
  }

  function volver() {
    if (paso === 1) return onVolver();
    setPaso((p) => p - 1);
  }

  // Antes de cargar el remito, mira si de este producto ya queda stock sin usar.
  // Si la consulta falla no bloquea el ingreso — solo se pierde el aviso.
  async function elegirProducto(producto: Producto) {
    setOverlay({ tipo: 'buscandoSaldo', producto });
    let saldoPrevio: LineaIngresoDisponible[] = [];
    try {
      const lineas = await lineasDisponibles(producto.id);
      saldoPrevio = lineas.filter((l) => Number(l.cantidadRestanteDisponible) > 0);
    } catch {
      saldoPrevio = [];
    }
    setOverlay({ tipo: 'tecladoRemito', producto, saldoPrevio });
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
            <div key={i} className="flex flex-col gap-2 rounded-2xl border border-borde bg-white px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-bold">{l.producto.nombre}</div>
                  <DetalleLinea linea={l} />
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
              <AvisoSaldoPrevio producto={l.producto} saldo={l.saldoPrevio} />
            </div>
          ))}
          {(() => {
            const yaCargados = new Set(lineas.map((l) => l.producto.id));
            const pendientes = (habituales.data ?? []).filter((p) => !yaCargados.has(p.id));
            if (pendientes.length === 0) return null;
            return (
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-bold text-texto-suave">Lo que suele traer este proveedor</div>
                <div className="flex flex-wrap gap-2">
                  {pendientes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void elegirProducto(p)}
                      className="min-h-11 cursor-pointer rounded-full border-2 border-primario bg-primario-suave px-4 text-sm font-bold text-primario hover:bg-chip"
                    >
                      + {p.nombre}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          <button
            type="button"
            onClick={() => setOverlay({ tipo: 'selectorProducto' })}
            className="min-h-[62px] w-full cursor-pointer rounded-2xl border-2 border-dashed border-borde-fuerte bg-transparent text-lg font-bold text-primario hover:bg-chip"
          >
            ＋ AGREGAR OTRO PRODUCTO
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
          {fotoPreview && (
            <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-primario bg-white p-3.5">
              <img
                src={fotoPreview}
                alt="Vista previa del remito"
                className="max-h-72 w-full rounded-xl border border-borde-fuerte object-contain"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-primario">
                    {subiendoFoto ? 'Subiendo…' : fotoUrl ? '✓ Foto cargada' : 'Foto no se pudo subir'}
                  </div>
                  <div className="truncate text-sm text-texto-suave">{fotoNombre}</div>
                </div>
                <button
                  type="button"
                  disabled={subiendoFoto}
                  onClick={() => inputFotoRef.current?.click()}
                  className="min-h-11 shrink-0 cursor-pointer rounded-xl border-2 border-primario bg-white px-4 text-sm font-bold text-primario hover:bg-chip disabled:opacity-50"
                >
                  CAMBIAR FOTO
                </button>
              </div>
            </div>
          )}
          <input
            ref={inputFotoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              if (archivo) {
                setFotoPreview((anterior) => {
                  if (anterior) URL.revokeObjectURL(anterior);
                  return URL.createObjectURL(archivo);
                });
                setFotoUrl(null);
                setSubiendoFoto(true);
                mutSubirFoto.mutate(archivo);
              }
              // Permite volver a elegir el mismo archivo si se cancela y se reintenta
              e.target.value = '';
            }}
          />
          {!fotoPreview && (
            <button
              type="button"
              disabled={subiendoFoto}
              onClick={() => inputFotoRef.current?.click()}
              className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-primario bg-white text-lg font-extrabold text-primario hover:bg-chip disabled:opacity-50"
            >
              SACAR FOTO O ELEGIR DE GALERÍA
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            disabled={subiendoFoto}
            onClick={() => setPaso(4)}
            className="min-h-15 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover disabled:opacity-50"
          >
            {subiendoFoto ? 'ESPERANDO LA FOTO…' : fotoPreview ? 'CONTINUAR' : 'SALTEAR'}
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
              <DetalleLinea linea={l} />
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
          idsDestacados={(habituales.data ?? []).map((p) => p.id)}
          etiquetaResto="Otros productos — no es lo que suele traer"
          onCancelar={() => setOverlay(null)}
          onSeleccionar={(item) => {
            const producto = materiasPrimas.data!.find((p) => p.id === item.id)!;
            void elegirProducto(producto);
          }}
        />
      )}

      {overlay?.tipo === 'buscandoSaldo' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/45">
          <div className="rounded-2xl bg-white px-6 py-5 text-base font-bold text-texto-suave">Un segundo…</div>
        </div>
      )}

      {overlay?.tipo === 'tecladoRemito' && (
        <TecladoNumerico
          titulo="¿Cuánto dice el remito?"
          subtitulo={overlay.producto.nombre}
          icono="📄"
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          pistaDisponible={
            overlay.saldoPrevio.length > 0 ? (
              <AvisoSaldoPrevio producto={overlay.producto} saldo={overlay.saldoPrevio} />
            ) : undefined
          }
          onCancelar={() => setOverlay(null)}
          onConfirmar={(remito) =>
            setOverlay({
              tipo: 'tecladoPesada',
              producto: overlay.producto,
              remito,
              saldoPrevio: overlay.saldoPrevio,
            })
          }
        />
      )}

      {/* Segundo paso en ámbar y con la referencia del remito arriba: si el
          operario repite el número del papel, que sea a propósito y no por
          inercia de venir de una pantalla idéntica. */}
      {overlay?.tipo === 'tecladoPesada' && (
        <TecladoNumerico
          titulo="Ahora pesalo vos"
          subtitulo={overlay.producto.nombre}
          icono="⚖️"
          variante="contraste"
          pistaDisponible={`El remito decía ${fmtNumero(overlay.remito)} ${overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'} — cargá lo que da la balanza`}
          unidad={overlay.producto.unidadDeMedida === 'KG' ? 'kg' : 'u'}
          permiteDecimal={overlay.producto.unidadDeMedida === 'KG'}
          onCancelar={() => setOverlay(null)}
          onConfirmar={(pesada) => {
            setLineas((ls) => [
              ...ls,
              {
                producto: overlay.producto,
                cantidadSegunRemito: overlay.remito,
                cantidadRealPesada: pesada,
                saldoPrevio: overlay.saldoPrevio,
              },
            ]);
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}
