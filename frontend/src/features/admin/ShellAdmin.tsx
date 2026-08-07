import { useCallback, useState } from 'react';
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
import { Turnos } from './Turnos';
import { StockMinimo } from './StockMinimo';
import { Dashboard } from './Dashboard';
import { Reportes } from './Reportes';

interface ItemNav {
  a: string;
  label: string;
  soloAdmin?: boolean;
}

const ITEMS_NAV: ItemNav[] = [
  { a: 'dashboard', label: 'Dashboard' },
  { a: 'alertas', label: 'Alertas', soloAdmin: true },
  { a: 'reportes', label: 'Reportes' },
  { a: 'turnos', label: 'Turnos' },
  { a: 'stock', label: 'Stock' },
  { a: 'stock-minimo', label: 'Stock mínimo' },
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
  const inicio = 'dashboard';

  // En celular el sidebar fijo se comía la pantalla (236 de 375 px, dejando 83
  // para el contenido). Por debajo de `md` pasa a ser un cajón que se abre
  // desde el botón de menú; de `md` para arriba queda igual que siempre.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <div className="flex min-h-screen bg-[#f2f4ee]">
      {/* Barra superior: solo en celular, es lo que abre el menú */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 bg-sidebar px-4 py-2.5 text-white md:hidden">
        <button
          type="button"
          onClick={() => setMenuAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
          className="flex h-11 w-11 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] hover:bg-[#1e3a29]"
        >
          <span className="block h-0.5 w-5.5 rounded bg-white" />
          <span className="block h-0.5 w-5.5 rounded bg-white" />
          <span className="block h-0.5 w-5.5 rounded bg-white" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-acento text-[13px] font-extrabold text-texto">
          L&amp;C
        </div>
        <div className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-wide">
          LIMÓN &amp; CHIMI
        </div>
        {esAdmin && (alertasNoVistas.data?.length ?? 0) > 0 && (
          <NavLink
            to="/admin/alertas"
            className="flex h-6 min-w-6 items-center justify-center rounded-full bg-error px-1.5 text-xs font-extrabold text-white"
          >
            {alertasNoVistas.data!.length}
          </NavLink>
        )}
      </div>

      {/* Fondo oscuro detrás del cajón abierto — tocarlo lo cierra */}
      {menuAbierto && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={cerrarMenu}
          className="fixed inset-0 z-40 cursor-pointer bg-black/45 md:hidden"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-59 flex-shrink-0 flex-col gap-1.5 overflow-y-auto bg-sidebar p-3.5 text-white transition-transform md:static md:z-auto md:translate-x-0 ${
          menuAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-2 pb-4.5">
          <div className="flex h-9.5 w-9.5 items-center justify-center rounded-[10px] bg-acento text-[13px] font-extrabold text-texto">
            L&amp;C
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-wide">LIMÓN &amp; CHIMI</div>
            <div className="text-[11px] text-sidebar-texto">Panel de gestión</div>
          </div>
        </div>

        {itemsVisibles.map((item) => (
          <NavLink
            key={item.a}
            to={`/admin/${item.a}`}
            onClick={cerrarMenu}
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

      {/* pt-16 en celular: deja lugar a la barra superior fija */}
      <div className="max-w-295 min-w-0 flex-1 overflow-auto p-4 pt-16 md:p-7">
        <Routes>
          <Route path="/" element={<Navigate to={inicio} replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          {esAdmin && <Route path="alertas" element={<Alertas />} />}
          <Route path="reportes" element={<Reportes />} />
          <Route path="turnos" element={<Turnos puedeEscribir={puedeEscribir} />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock-minimo" element={<StockMinimo puedeEscribir={puedeEscribir} />} />
          <Route path="produccion" element={<ProduccionLotes />} />
          <Route path="transferencias" element={<Transferencias puedeEscribir={esAdmin} />} />
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
