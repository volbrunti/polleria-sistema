import { Navigate, Outlet } from 'react-router-dom';
import type { Rol } from '../api/types';
import { useAuth } from './AuthContext';

export function rutaInicioPorRol(rol: Rol): string {
  switch (rol) {
    case 'PRODUCCION':
      return '/produccion';
    case 'CAJERO':
    case 'ENCARGADO':
      return '/local';
    case 'ADMINISTRADOR':
    case 'SOCIO':
      return '/admin';
  }
}

export function RutaProtegida({ rolesPermitidos }: { rolesPermitidos: Rol[] }) {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-texto-suave">
        Cargando…
      </div>
    );
  }

  if (!usuario) return <Navigate to="/login" replace />;

  if (!rolesPermitidos.includes(usuario.rol)) {
    return <Navigate to={rutaInicioPorRol(usuario.rol)} replace />;
  }

  return <Outlet />;
}
