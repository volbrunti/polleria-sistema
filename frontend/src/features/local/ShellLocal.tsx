import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { listarSucursales } from '../../api/sucursales';
import type { Sucursal, Transferencia } from '../../api/types';
import { EntregasPendientes } from './EntregasPendientes';
import { ConteoCiego } from './ConteoCiego';
import { ResultadoRecepcion } from './ResultadoRecepcion';
import { MisRecepciones } from './MisRecepciones';
import { StockLocal } from './StockLocal';

type Pantalla = 'lista' | 'conteo' | 'ok' | 'diff' | 'registrado' | 'historial';
type Tab = 'recibir' | 'stock';

const CLAVE_SUCURSAL = 'polleria.sucursalLocal';

export function ShellLocal() {
  const { usuario, salir } = useAuth();
  const esEncargado = usuario?.rol === 'ENCARGADO';

  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const locales = sucursales.data?.filter((s) => s.tipo === 'VENTA') ?? [];

  // Si el usuario ya tiene una sucursal fija asignada (backend la valida en
  // cada recepción), se usa esa siempre — no hay picker que valga: intentar
  // operar sobre otro local devuelve SUCURSAL_NO_AUTORIZADA de todos modos.
  // El picker manual solo queda como red de contención para cuentas viejas
  // sin sucursal asignada (ver CLAUDE.md §11).
  const sucursalFija = usuario?.sucursalId ?? null;

  const [sucursalElegida, setSucursalElegida] = useState<number | null>(() => {
    const guardado = sessionStorage.getItem(CLAVE_SUCURSAL);
    return guardado ? Number(guardado) : null;
  });

  useEffect(() => {
    if (sucursalFija == null && sucursalElegida == null && locales.length > 0) {
      setSucursalElegida(locales[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locales.length, sucursalFija]);

  useEffect(() => {
    if (sucursalFija == null && sucursalElegida != null) {
      sessionStorage.setItem(CLAVE_SUCURSAL, String(sucursalElegida));
    }
  }, [sucursalElegida, sucursalFija]);

  const sucursalId = sucursalFija ?? sucursalElegida;

  const sucursal: Sucursal | undefined = locales.find((s) => s.id === sucursalId);

  const [tab, setTab] = useState<Tab>('recibir');
  const [pantalla, setPantalla] = useState<Pantalla>('lista');
  const [transferenciaActual, setTransferenciaActual] = useState<Transferencia | null>(null);
  const [valoresConteo, setValoresConteo] = useState<Record<number, number>>({});

  function irALista() {
    setPantalla('lista');
    setTransferenciaActual(null);
    setValoresConteo({});
  }

  return (
    <div className="flex min-h-screen justify-center bg-fondo px-4 py-7">
      <div className="relative flex min-h-[660px] w-full max-w-[880px] flex-col overflow-hidden rounded-[22px] border border-borde bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-borde bg-white px-5.5 py-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-acento text-sm font-extrabold text-texto">
            L&amp;C
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold">Hola, {usuario?.nombre}</div>
            <div className="flex items-center gap-1.5 text-sm text-texto-suave">
              <span>{esEncargado ? 'Encargado' : 'Cajero'}</span>
              {sucursalFija == null && locales.length > 1 ? (
                <select
                  value={sucursalElegida ?? ''}
                  onChange={(e) => setSucursalElegida(Number(e.target.value))}
                  className="rounded-md border border-borde-fuerte bg-white px-1.5 py-0.5 text-sm"
                >
                  {locales.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                sucursal && <span>· {sucursal.nombre}</span>
              )}
            </div>
          </div>
          {esEncargado && (
            <div className="flex gap-2 rounded-xl bg-chip p-1.5">
              <button
                type="button"
                onClick={() => setTab('recibir')}
                className={`min-h-[46px] cursor-pointer rounded-lg px-4.5 text-base font-bold ${
                  tab === 'recibir' ? 'bg-primario text-white' : 'bg-transparent text-texto-suave'
                }`}
              >
                Recibir
              </button>
              <button
                type="button"
                onClick={() => setTab('stock')}
                className={`min-h-[46px] cursor-pointer rounded-lg px-4.5 text-base font-bold ${
                  tab === 'stock' ? 'bg-primario text-white' : 'bg-transparent text-texto-suave'
                }`}
              >
                Stock
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void salir()}
            className="min-h-11 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-sm font-semibold text-texto-suave hover:text-texto"
          >
            Salir
          </button>
        </div>

        {tab === 'stock' ? (
          sucursalId != null && <StockLocal sucursalId={sucursalId} sucursalNombre={sucursal?.nombre ?? ''} />
        ) : (
          <>
            {pantalla === 'lista' && sucursalId != null && (
              <EntregasPendientes
                sucursalId={sucursalId}
                onAbrir={(t) => {
                  setTransferenciaActual(t);
                  setValoresConteo({});
                  setPantalla('conteo');
                }}
                onIrHistorial={() => setPantalla('historial')}
              />
            )}

            {pantalla === 'conteo' && transferenciaActual && (
              <ConteoCiego
                transferencia={transferenciaActual}
                valores={valoresConteo}
                onCambiarValores={setValoresConteo}
                onVolver={irALista}
                onCoincide={() => setPantalla('ok')}
                onNoCoincide={() => setPantalla('diff')}
              />
            )}

            {pantalla === 'ok' && (
              <ResultadoRecepcion variante="ok" onListo={irALista} />
            )}

            {pantalla === 'diff' && transferenciaActual && (
              <ResultadoRecepcion
                variante="diff"
                transferenciaId={transferenciaActual.id}
                valores={valoresConteo}
                onRecontar={() => setPantalla('conteo')}
                onConfirmado={() => setPantalla('registrado')}
              />
            )}

            {pantalla === 'registrado' && <ResultadoRecepcion variante="registrado" onListo={irALista} />}

            {pantalla === 'historial' && sucursalId != null && (
              <MisRecepciones sucursalId={sucursalId} onVolver={irALista} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
