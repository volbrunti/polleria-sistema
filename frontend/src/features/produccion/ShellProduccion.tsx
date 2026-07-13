import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { listarLotes } from '../../api/produccion';
import { MenuProduccion } from './MenuProduccion';
import { AsistenteIngreso } from './AsistenteIngreso';
import { AsistenteProducir } from './AsistenteProducir';
import { LoteAbierto } from './LoteAbierto';
import { AsistenteEnviar } from './AsistenteEnviar';
import { MisEnvios } from './MisEnvios';

type Pantalla = 'menu' | 'ingreso' | 'producir' | 'lote' | 'enviar' | 'envios';

export function ShellProduccion() {
  const { usuario, salir } = useAuth();
  const [pantalla, setPantalla] = useState<Pantalla>('menu');
  const [loteActivoId, setLoteActivoId] = useState<number | null>(null);

  const lotesAbiertos = useQuery({
    queryKey: ['lotes', 'abierto'],
    queryFn: () => listarLotes({ estado: 'ABIERTO' }),
  });

  const loteDelOperario = lotesAbiertos.data?.find((l) => l.usuarioOperarioId === usuario?.id) ?? null;
  const idLoteAMostrar = loteActivoId ?? loteDelOperario?.id ?? null;

  function volverAlMenu() {
    setPantalla('menu');
    setLoteActivoId(null);
    void lotesAbiertos.refetch();
  }

  return (
    <div className="flex min-h-screen justify-center bg-fondo px-3 py-7 sm:px-6">
      <div className="relative flex min-h-[800px] w-full max-w-[402px] flex-col overflow-hidden rounded-[28px] border border-borde bg-panel shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-borde bg-white px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-acento text-sm font-extrabold text-texto">
            L&amp;C
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">Hola, {usuario?.nombre}</div>
            <div className="text-xs text-texto-suave">Producción</div>
          </div>
          <button
            type="button"
            onClick={() => void salir()}
            className="min-h-10 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-3.5 text-sm font-semibold text-texto-suave hover:text-texto"
          >
            Salir
          </button>
        </div>

        {pantalla === 'menu' && (
          <MenuProduccion
            loteAbierto={loteDelOperario}
            onIrIngreso={() => setPantalla('ingreso')}
            onIrProducir={() => setPantalla('producir')}
            onIrEnviar={() => setPantalla('enviar')}
            onIrEnvios={() => setPantalla('envios')}
            onIrLote={(id) => {
              setLoteActivoId(id);
              setPantalla('lote');
            }}
          />
        )}

        {pantalla === 'ingreso' && <AsistenteIngreso onVolver={volverAlMenu} onFinalizado={volverAlMenu} />}

        {pantalla === 'producir' && (
          <AsistenteProducir
            onVolver={volverAlMenu}
            onLoteAbierto={(id) => {
              setLoteActivoId(id);
              setPantalla('lote');
            }}
          />
        )}

        {pantalla === 'lote' && idLoteAMostrar != null && (
          <LoteAbierto loteId={idLoteAMostrar} onVolverMenu={volverAlMenu} onCerrado={volverAlMenu} />
        )}

        {pantalla === 'enviar' && <AsistenteEnviar onVolver={volverAlMenu} onFinalizado={volverAlMenu} />}

        {pantalla === 'envios' && <MisEnvios onVolver={volverAlMenu} />}
      </div>
    </div>
  );
}
