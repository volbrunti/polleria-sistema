import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { rutaInicioPorRol } from '../../auth/RutaProtegida';

// Atajos para no tipear credenciales mientras se desarrolla. Las claves
// quedan EN EL BUNDLE, así que en una URL pública esto es un botón de "entrar
// como administrador" para cualquiera que la encuentre. Por eso solo se
// muestran en dev, o si se pide explícitamente con VITE_MOSTRAR_DEMO=true
// (para una demo con el cliente, sabiendo lo que implica).
const ACCESOS_DEMO = [
  { username: 'admin', password: 'admin123', label: 'Admin' },
  { username: 'ariel', password: 'socio123', label: 'Socio (Ariel)' },
  { username: 'encargado', password: 'encargado123', label: 'Encargado' },
  { username: 'cajero', password: 'cajero123', label: 'Cajero' },
  { username: 'produccion', password: 'produccion123', label: 'Producción' },
];

const MOSTRAR_DEMO = import.meta.env.DEV || import.meta.env.VITE_MOSTRAR_DEMO === 'true';

export function PaginaLogin() {
  const { ingresar, usuario } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [enviando, setEnviando] = useState(false);

  if (usuario) {
    return <Navigate to={rutaInicioPorRol(usuario.rol)} replace />;
  }

  async function intentarIngresar(u: string, p: string) {
    setError(false);
    setEnviando(true);
    try {
      await ingresar(u, p);
    } catch {
      setError(true);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-[430px] flex-col gap-4">
        <div className="flex flex-col items-center gap-2.5 pb-2">
          <div className="flex h-17 w-17 items-center justify-center rounded-2xl bg-acento text-2xl font-extrabold text-texto">
            L&amp;C
          </div>
          <div className="text-2xl font-extrabold tracking-wide">LIMÓN &amp; CHIMI</div>
          <div className="text-sm text-texto-suave">Sistema de gestión · Módulo 1</div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void intentarIngresar(username, password);
          }}
          className="flex flex-col gap-3.5 rounded-[18px] border border-borde bg-white p-6"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lu" className="text-base font-semibold">
              Usuario
            </label>
            <input
              id="lu"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-14 rounded-xl border-2 border-borde-fuerte px-4 text-lg outline-primario"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lp" className="text-base font-semibold">
              Contraseña
            </label>
            <input
              id="lp"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-14 rounded-xl border-2 border-borde-fuerte px-4 text-lg outline-primario"
            />
          </div>
          {error && (
            <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-semibold text-error-texto">
              Usuario o contraseña incorrectos
            </div>
          )}
          <button
            type="submit"
            disabled={enviando}
            className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-xl font-extrabold tracking-wide text-white hover:bg-primario-hover disabled:opacity-60"
          >
            ENTRAR
          </button>
        </form>

        {MOSTRAR_DEMO && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-borde-fuerte bg-white p-4">
          <div className="text-sm font-semibold text-texto-suave">DEMO — entrar directo como:</div>
          <div className="flex flex-wrap gap-2">
            {ACCESOS_DEMO.map((u) => (
              <button
                key={u.username}
                type="button"
                onClick={() => {
                  setUsername(u.username);
                  setPassword(u.password);
                  void intentarIngresar(u.username, u.password);
                }}
                className="min-h-11 cursor-pointer rounded-lg border-2 border-borde-fuerte px-3.5 text-base font-semibold text-texto hover:border-primario hover:text-primario"
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
