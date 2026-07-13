import { useCallback } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { useAlertasSocket } from '../../lib/useSocket';
import { listarAlertas } from '../../api/alertas';
import { Alertas } from './Alertas';
import { Stock } from './Stock';
import { ProduccionLotes } from './ProduccionLotes';
import { Transferencias } from './Transferencias';
import { FichasTecnicas } from './FichasTecnicas';
import { Catalogo } from './Catalogo';
import { Usuarios } from './Usuarios';
import { Auditoria } from './Auditoria';

interface ItemNav {
  a: string;
  label: string;
  soloAdmin?: boolean;
}

const ITEMS_NAV: ItemNav[] = [
  { a: 'alertas', label: 'Alertas', soloAdmin: true },
  { a: 'stock', label: 'Stock' },
  { a: 'produccion', label: 'Producción' },
  { a: 'transferencias', label: 'Transferencias' },
  { a: 'fichas-tecnicas', label: 'Fichas técnicas' },
  { a: 'catalogo', label: 'Catálogo' },
  { a: 'usuarios', label: 'Usuarios', soloAdmin: true },
  { a: 'auditoria', label: 'Auditoría' },
];

export function ShellAdmin() {
  const { usuario, salir } = useAuth();
  const esAdmin = usuario?.rol === 'ADMINISTRADOR';
  const puedeEscribir = esAdmin;
  const queryClient = useQueryClient();

  const alertasNoVistas = useQuery({
    queryKey: ['alertas', 'no-vistas'],
    queryFn: () => listarAlertas({ vista: false }),
    enabled: esAdmin,
    refetchInterval: 30000,
  });

  const onAlertaNueva = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['alertas'] });
  }, [queryClient]);
  useAlertasSocket(onAlertaNueva);

  const itemsVisibles = ITEMS_NAV.filter((i) => !i.soloAdmin || esAdmin);
  const inicio = esAdmin ? 'alertas' : 'stock';

  return (
    <div className="flex min-h-screen bg-[#f2f4ee]">
      <div className="flex h-screen w-59 flex-shrink-0 flex-col gap-1.5 bg-sidebar p-3.5 text-white">
        <div className="flex items-center gap-2.5 px-2 pb-4.5">
          <div className="flex h-9.5 w-9.5 items-center justify-center rounded-[10px] bg-acento text-[13px] font-extrabold text-texto">
            L&amp;C
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-wide">LIMÓN &amp; CHIMI</div>
            <div className="text-[11px] text-sidebar-texto">Módulo 1</div>
          </div>
        </div>

        {itemsVisibles.map((item) => (
          <NavLink
            key={item.a}
            to={`/admin/${item.a}`}
            className={({ isActive }) =>
              `flex min-h-[46px] items-center gap-2.5 rounded-[10px] px-3 text-[15px] font-semibold ${
                isActive ? 'bg-primario text-white' : 'text-white/85 hover:bg-[#1e3a29]'
              }`
            }
          >
            <span className="flex-1">{item.label}</span>
            {item.a === 'alertas' && (alertasNoVistas.data?.length ?? 0) > 0 && (
              <span className="flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-error px-1.5 text-xs font-extrabold text-white">
                {alertasNoVistas.data!.length}
              </span>
            )}
          </NavLink>
        ))}

        <div className="flex-1" />
        <div className="flex items-center gap-2.5 border-t border-sidebar-borde px-2 pt-3.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">Hola, {usuario?.nombre}</div>
            <div className="text-xs text-sidebar-texto">{usuario?.rol}</div>
          </div>
          <button
            type="button"
            onClick={() => void salir()}
            className="min-h-9.5 cursor-pointer rounded-lg border border-sidebar-borde bg-transparent px-3 text-xs font-semibold text-white/80 hover:bg-[#1e3a29]"
          >
            Salir
          </button>
        </div>
      </div>

      <div className="max-w-295 flex-1 overflow-auto p-7">
        <Routes>
          <Route path="/" element={<Navigate to={inicio} replace />} />
          {esAdmin && <Route path="alertas" element={<Alertas />} />}
          <Route path="stock" element={<Stock />} />
          <Route path="produccion" element={<ProduccionLotes />} />
          <Route path="transferencias" element={<Transferencias />} />
          <Route path="fichas-tecnicas" element={<FichasTecnicas puedeEscribir={puedeEscribir} />} />
          <Route path="catalogo" element={<Catalogo puedeEscribir={puedeEscribir} />} />
          {esAdmin && <Route path="usuarios" element={<Usuarios />} />}
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Routes>
      </div>
    </div>
  );
}
