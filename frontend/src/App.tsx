import { Navigate, Route, Routes } from 'react-router-dom';
import { RutaProtegida } from './auth/RutaProtegida';
import { useAuth } from './auth/AuthContext';
import { PaginaLogin } from './features/login/PaginaLogin';
import { ShellProduccion } from './features/produccion/ShellProduccion';
import { ShellLocal } from './features/local/ShellLocal';
import { ShellAdmin } from './features/admin/ShellAdmin';
import { BannerSinConexion } from './components/ui/BannerSinConexion';

const DESTINO_POR_ROL = {
  PRODUCCION: '/produccion',
  CAJERO: '/local',
  ENCARGADO: '/local',
  ADMINISTRADOR: '/admin',
  SOCIO: '/admin',
} as const;

function Raiz() {
  const { usuario, cargando } = useAuth();
  if (cargando) return null;
  if (!usuario) return <Navigate to="/login" replace />;
  return <Navigate to={DESTINO_POR_ROL[usuario.rol]} replace />;
}

export default function App() {
  return (
    <>
      <BannerSinConexion />
      <Routes>
        <Route path="/" element={<Raiz />} />
        <Route path="/login" element={<PaginaLogin />} />

        <Route element={<RutaProtegida rolesPermitidos={['PRODUCCION']} />}>
          <Route path="/produccion/*" element={<ShellProduccion />} />
        </Route>

        <Route element={<RutaProtegida rolesPermitidos={['CAJERO', 'ENCARGADO']} />}>
          <Route path="/local/*" element={<ShellLocal />} />
        </Route>

        <Route element={<RutaProtegida rolesPermitidos={['ADMINISTRADOR', 'SOCIO']} />}>
          <Route path="/admin/*" element={<ShellAdmin />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
