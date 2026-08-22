import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { useAlertasSocket } from '../../lib/useSocket';
import { ErrorBoundary } from '../../lib/ErrorBoundary';
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
  const location = useLocation();

  // Cada sección va en su propio boundary: si una pantalla revienta al
  // dibujarse, el sidebar y el resto del panel siguen usables, en vez de
  // quedar toda la app en blanco.
  const seccion = (nombre: string, contenido: ReactNode) => (
    <ErrorBoundary nombre={nombre} claveReset={location.pathname}>
      {contenido}
    </ErrorBoundary>
  );

  // En celular el sidebar fijo se comía la pantalla (236 de 375 px, dejando 83
  // para el contenido). Por debajo de `md` se reemplaza por un menú a pantalla
  // completa con ítems grandes — no por el mismo sidebar encogido, que deja los
  // destinos apretados justo donde se navega con el pulgar. De `md` para arriba
  // el sidebar queda igual que siempre: con 12 secciones, un navbar horizontal
  // las apretaría.
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
          // El contador era un blanco de 24 px: el único control de la app
          // móvil por debajo de los 44 px recomendados (auditoría 2026-08-07,
          // V-3). El área táctil se agranda sin agrandar la píldora roja.
          <NavLink
            to="/admin/alertas"
            aria-label={`${alertasNoVistas.data!.length} alertas sin ver`}
            className="flex h-11 min-w-11 items-center justify-center"
          >
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-error px-1.5 text-xs font-extrabold text-white">
              {alertasNoVistas.data!.length}
            </span>
          </NavLink>
        )}
      </div>

      {/* Menú de celular: pantalla completa, un destino por línea y tipografía
          grande. Solo existe por debajo de `md`. */}
      {menuAbierto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-sidebar text-white md:hidden">
          <div className="flex items-center gap-3 border-b border-sidebar-borde px-4 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-acento text-[13px] font-extrabold text-texto">
              L&amp;C
            </div>
            <div className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-wide">
              LIMÓN &amp; CHIMI
            </div>
            <button
              type="button"
              onClick={cerrarMenu}
              aria-label="Cerrar menú"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-3xl leading-none font-light hover:bg-[#1e3a29]"
            >
              ×
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-5 py-6">
            {itemsVisibles.map((item) => (
              <NavLink
                key={item.a}
                to={`/admin/${item.a}`}
                onClick={cerrarMenu}
                className={({ isActive }) =>
                  `flex min-h-[58px] items-center gap-3 text-2xl font-extrabold tracking-wide uppercase ${
                    isActive ? 'text-sidebar-texto' : 'text-white'
                  }`
                }
              >
                <span className="flex-1">{item.label}</span>
                {item.a === 'alertas' && (alertasNoVistas.data?.length ?? 0) > 0 && (
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-error px-2 text-sm font-extrabold text-white">
                    {alertasNoVistas.data!.length}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 border-t border-sidebar-borde px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">Hola, {usuario?.nombre}</div>
              <div className="text-xs text-sidebar-texto">{usuario?.rol}</div>
            </div>
            <button
              type="button"
              onClick={() => void salir()}
              className="min-h-11 cursor-pointer rounded-xl border border-sidebar-borde bg-transparent px-4 text-sm font-semibold text-white/85"
            >
              Salir
            </button>
          </div>
        </div>
      )}

      {/* Sidebar de escritorio — oculto en celular, ahí manda el menú de arriba */}
      <div className="hidden h-screen w-59 flex-shrink-0 flex-col gap-1.5 overflow-y-auto bg-sidebar p-3.5 text-white md:flex">
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
          <Route path="dashboard" element={seccion('el dashboard', <Dashboard />)} />
          {esAdmin && <Route path="alertas" element={seccion('las alertas', <Alertas />)} />}
          <Route path="reportes" element={seccion('los reportes', <Reportes />)} />
          <Route path="turnos" element={seccion('los turnos', <Turnos puedeEscribir={puedeEscribir} />)} />
          <Route path="stock" element={seccion('el stock', <Stock puedeEscribir={puedeEscribir} />)} />
          <Route
            path="stock-minimo"
            element={seccion('el stock mínimo', <StockMinimo puedeEscribir={puedeEscribir} />)}
          />
          <Route path="produccion" element={seccion('la producción', <ProduccionLotes />)} />
          <Route
            path="transferencias"
            element={seccion('las transferencias', <Transferencias puedeEscribir={esAdmin} />)}
          />
          <Route
            path="fichas-tecnicas"
            element={seccion('las fichas técnicas', <FichasTecnicas puedeEscribir={puedeEscribir} />)}
          />
          <Route path="catalogo" element={seccion('el catálogo', <Catalogo puedeEscribir={puedeEscribir} />)} />
          {esAdmin && <Route path="usuarios" element={seccion('los usuarios', <Usuarios />)} />}
          <Route path="auditoria" element={seccion('la auditoría', <Auditoria />)} />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Routes>
      </div>
    </div>
  );
}
