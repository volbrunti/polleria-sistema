import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarUsuarios, crearUsuario, actualizarUsuario } from '../../api/usuarios';
import { listarSucursales } from '../../api/sucursales';
import { ApiError } from '../../api/client';
import type { Rol, Usuario } from '../../api/types';

const ROLES: Rol[] = ['ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO', 'PRODUCCION'];
const ROLES_CON_SUCURSAL: Rol[] = ['CAJERO', 'ENCARGADO'];

export function Usuarios() {
  const queryClient = useQueryClient();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: listarUsuarios });
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const locales = sucursales.data?.filter((s) => s.tipo === 'VENTA') ?? [];

  const [editando, setEditando] = useState<Usuario | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<Rol>('CAJERO');
  const [activo, setActivo] = useState(true);
  const [sucursalId, setSucursalId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const necesitaSucursal = ROLES_CON_SUCURSAL.includes(rol);

  function abrirNuevo() {
    setEditando(null);
    setNombre('');
    setUsername('');
    setPassword('');
    setRol('CAJERO');
    setActivo(true);
    setSucursalId(null);
    setAbierto(true);
    setError(null);
  }

  function abrirEditar(u: Usuario) {
    setEditando(u);
    setNombre(u.nombre);
    setUsername(u.username);
    setPassword('');
    setRol(u.rol);
    setActivo(u.activo ?? true);
    setSucursalId(u.sucursalId ?? null);
    setAbierto(true);
    setError(null);
  }

  const mutCrear = useMutation({
    mutationFn: crearUsuario,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.'),
  });

  const mutActualizar = useMutation({
    mutationFn: (vars: {
      id: number;
      nombre: string;
      rol: Rol;
      activo: boolean;
      password?: string;
      sucursalId: number | null;
    }) =>
      actualizarUsuario(vars.id, {
        nombre: vars.nombre,
        rol: vars.rol,
        activo: vars.activo,
        sucursalId: vars.sucursalId,
        ...(vars.password ? { password: vars.password } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setAbierto(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5">
        <h1 className="m-0 flex-1 text-2xl font-extrabold">Usuarios</h1>
        {!abierto && (
          <button
            type="button"
            onClick={abrirNuevo}
            className="min-h-12 cursor-pointer rounded-xl bg-primario px-5 text-[15px] font-extrabold text-white hover:bg-primario-hover"
          >
            ＋ NUEVO USUARIO
          </button>
        )}
      </div>

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-primario bg-white p-4.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuario"
              disabled={!!editando}
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm disabled:bg-panel disabled:text-texto-suave"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editando ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              className="h-11.5 rounded-[10px] border border-borde-fuerte px-3 text-sm"
            />
            <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {necesitaSucursal && (
              <select
                value={sucursalId ?? ''}
                onChange={(e) => setSucursalId(e.target.value ? Number(e.target.value) : null)}
                className="h-11.5 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
              >
                <option value="">Sin sucursal (no podrá recepcionar)</option>
                {locales.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                  </option>
                ))}
              </select>
            )}
            {editando && (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-5 w-5" />
                Activo
              </label>
            )}
          </div>
          {error && <div className="rounded-xl bg-error-suave px-3.5 py-2.5 text-sm font-semibold text-error-texto">{error}</div>}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setAbierto(false)} className="min-h-11.5 cursor-pointer rounded-xl border-2 border-borde-fuerte bg-white px-4 text-sm font-bold text-texto-suave">
              Cancelar
            </button>
            <button
              type="button"
              disabled={
                !nombre.trim() ||
                !username.trim() ||
                (!editando && password.length < 6) ||
                mutCrear.isPending ||
                mutActualizar.isPending
              }
              onClick={() => {
                setError(null);
                const sucursalAEnviar = necesitaSucursal ? sucursalId : null;
                if (editando) {
                  mutActualizar.mutate({
                    id: editando.id,
                    nombre,
                    rol,
                    activo,
                    password: password || undefined,
                    sucursalId: sucursalAEnviar,
                  });
                } else {
                  mutCrear.mutate({ nombre, username, password, rol, sucursalId: sucursalAEnviar });
                }
              }}
              className="min-h-11.5 cursor-pointer rounded-xl bg-primario px-5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              GUARDAR
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <div className="grid grid-cols-[1fr_160px_180px_140px_100px_110px] bg-chip px-5 py-3 text-xs font-extrabold tracking-wide text-texto-suave">
          <span>NOMBRE</span>
          <span>USUARIO</span>
          <span>ROL</span>
          <span>SUCURSAL</span>
          <span>ACTIVO</span>
          <span />
        </div>
        {usuarios.data?.map((u) => (
          <div key={u.id} className="grid grid-cols-[1fr_160px_180px_140px_100px_110px] items-center border-t border-[#eef1ea] px-5 py-3.5 text-sm">
            <span className="font-semibold">{u.nombre}</span>
            <span className="font-mono text-[13px] text-texto-suave">{u.username}</span>
            <span>{u.rol}</span>
            <span className="text-texto-suave">
              {ROLES_CON_SUCURSAL.includes(u.rol)
                ? (locales.find((l) => l.id === u.sucursalId)?.nombre ?? '— sin asignar —')
                : '—'}
            </span>
            <span className="font-bold" style={{ color: u.activo ? '#1a7f3f' : '#a02514' }}>
              {u.activo ? 'Sí' : 'No'}
            </span>
            <button type="button" onClick={() => abrirEditar(u)} className="min-h-9 w-fit cursor-pointer rounded-lg border border-borde-fuerte bg-white px-3.5 text-[13px] font-bold text-primario">
              Editar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
