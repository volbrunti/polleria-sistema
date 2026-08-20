import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarAuditoria } from '../../api/auditoria';
import { listarUsuarios } from '../../api/usuarios';
import { listarProductos } from '../../api/productos';
import { listarSucursales } from '../../api/sucursales';
import { useAuth } from '../../auth/AuthContext';
import { fmtFechaHora, fmtNumero } from '../../lib/formato';
import { ErrorDeCarga } from '../../components/ui/ErrorDeCarga';

interface Resolvers {
  productos: Map<number, string>;
  usuarios: Map<number, string>;
  sucursales: Map<number, string>;
}

// Traduce el código de acción (tal como lo graba registrarAuditoria en cada
// servicio) a una frase legible para el admin/socio. Si aparece una acción
// nueva que no está acá, se muestra igual con un fallback razonable (mayúsculas
// -> espacios) — nunca se rompe por una acción no mapeada.
const ETIQUETA_ACCION: Record<string, string> = {
  REGISTRAR_INGRESO_MERCADERIA: 'Registró un ingreso de mercadería',
  ABRIR_LOTE_PRODUCCION: 'Abrió un lote de producción',
  CERRAR_LOTE_PRODUCCION: 'Cerró un lote de producción',
  CREAR_FICHA_TECNICA: 'Creó una ficha técnica',
  NUEVA_VERSION_FICHA_TECNICA: 'Creó una nueva versión de ficha técnica',
  GENERAR_TRANSFERENCIA: 'Generó una transferencia',
  CONFIRMAR_TRANSFERENCIA: 'Confirmó una transferencia',
  CONFIRMAR_TRANSFERENCIA_CON_DISCREPANCIA: 'Confirmó una transferencia con discrepancia',
  CREAR_PRODUCTO: 'Creó un producto',
  ACTUALIZAR_PRODUCTO: 'Actualizó un producto',
  CAMBIO_PRECIO: 'Cambió un precio',
  CREAR_COMBO: 'Creó un combo',
  ACTUALIZAR_COMPONENTES_COMBO: 'Actualizó los componentes de un combo',
  CREAR_PROVEEDOR: 'Creó un proveedor',
  ACTUALIZAR_PROVEEDOR: 'Actualizó un proveedor',
  CONFIGURAR_PRODUCTOS_HABITUALES: 'Configuró los productos habituales de un proveedor',
  CREAR_USUARIO: 'Creó un usuario',
  ACTUALIZAR_USUARIO: 'Actualizó un usuario',
  ELIMINAR_USUARIO: 'Eliminó un usuario',
  CREAR_SUCURSAL: 'Creó una sucursal',
  ACTUALIZAR_SUCURSAL: 'Actualizó una sucursal',
  CONFIGURAR_STOCK_MINIMO: 'Configuró el stock mínimo',
  ABRIR_TURNO: 'Abrió un turno',
  CERRAR_TURNO: 'Cerró un turno',
  BLOQUEO_TURNO: 'Se bloqueó un turno por discrepancia',
  DESBLOQUEO_TURNO_REMOTO: 'Desbloqueó un turno (remoto)',
  DESBLOQUEO_TURNO_CLAVE: 'Desbloqueó un turno (clave de emergencia)',
  GENERAR_CLAVE_EMERGENCIA: 'Generó una clave de emergencia',
  CONFIRMAR_PEDIDO: 'Confirmó un pedido',
  MODIFICAR_PEDIDO: 'Modificó un pedido',
  COBRAR_PEDIDO: 'Cobró un pedido',
  MARCAR_PEDIDO_LISTO: 'Marcó un pedido como listo',
  PEDIDO_NO_RETIRADO: 'Marcó un pedido como no retirado',
  REASIGNAR_PEDIDO: 'Reasignó un pedido',
  MARCAR_PEDIDO_PERDIDO: 'Marcó un pedido como perdido',
  ANULAR_PEDIDO: 'Anuló un pedido',
  REGISTRAR_ATENCION: 'Registró una atención/regalía',
  REGISTRAR_GASTO_CAJA: 'Registró un gasto de caja',
  REGISTRAR_RETIRO_CAJA: 'Registró un retiro de caja',
  MARCAR_POLLOS: 'Marcó pollos (del freezer a la parrilla)',
  VENTA_COSTO_CERO: 'Registró una merma o un retorno a producción',
};

function accionLegible(accion: string): string {
  return (
    ETIQUETA_ACCION[accion] ??
    accion.charAt(0) + accion.slice(1).toLowerCase().replace(/_/g, ' ')
  );
}

// camelCase -> "Campo humanizado"
function etiquetaCampo(clave: string): string {
  const conEspacios = clave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Resuelve un campo "xxxId" a "Nombre real (#id)" cuando el nombre de la
// clave deja claro a qué entidad se refiere — así "Producto insumo id: 1"
// se ve como "Producto insumo: Nalga de pollo (kg) (#1)".
function resolverId(clave: string, valor: number, resolvers: Resolvers): string | null {
  const c = clave.toLowerCase();
  if (c.includes('producto') && c.endsWith('id')) {
    const nombre = resolvers.productos.get(valor);
    if (nombre) return `${nombre} (#${valor})`;
  }
  if (c.includes('usuario') && c.endsWith('id')) {
    const nombre = resolvers.usuarios.get(valor);
    if (nombre) return `${nombre} (#${valor})`;
  }
  if (c.includes('sucursal') && c.endsWith('id')) {
    const nombre = resolvers.sucursales.get(valor);
    if (nombre) return `${nombre} (#${valor})`;
  }
  return null;
}

// El detalle (datosAnteriores/datosNuevos) es JSON arbitrario según la acción
// — se renderiza como pares "campo: valor" legibles, nunca como texto JSON
// crudo. Objetos y arrays anidados se muestran indentados recursivamente.
// Los campos "xxxId" que se pueden resolver a un producto o usuario real
// muestran el nombre en vez del número solo.
function ValorDato({ clave, valor, resolvers }: { clave?: string; valor: unknown; resolvers: Resolvers }) {
  if (valor === null || valor === undefined || valor === '') {
    return <span className="text-texto-suave">—</span>;
  }
  if (typeof valor === 'boolean') return <span>{valor ? 'Sí' : 'No'}</span>;
  if (typeof valor === 'number') {
    const resuelto = clave ? resolverId(clave, valor, resolvers) : null;
    return <span>{resuelto ?? fmtNumero(valor)}</span>;
  }
  if (typeof valor === 'string') {
    if (RE_FECHA_ISO.test(valor)) return <span>{fmtFechaHora(valor)}</span>;
    return <span className="break-words">{valor}</span>;
  }
  if (Array.isArray(valor)) {
    if (valor.length === 0) return <span className="text-texto-suave">Ninguno</span>;
    if (valor.every((v) => typeof v !== 'object' || v === null)) {
      return <span className="break-words">{valor.map(String).join(', ')}</span>;
    }
    return (
      <div className="flex flex-col gap-1.5">
        {valor.map((item, i) => (
          <div key={i} className="rounded-lg border border-borde bg-panel px-2.5 py-2">
            <ObjetoDatos datos={item as Record<string, unknown>} resolvers={resolvers} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof valor === 'object') return <ObjetoDatos datos={valor as Record<string, unknown>} resolvers={resolvers} />;
  return <span className="break-words">{String(valor)}</span>;
}

function ObjetoDatos({ datos, resolvers }: { datos: Record<string, unknown>; resolvers: Resolvers }) {
  const entradas = Object.entries(datos);
  if (entradas.length === 0) return <span className="text-texto-suave">—</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {entradas.map(([clave, valor]) => (
        <div key={clave} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <span className="shrink-0 text-[12px] font-bold text-texto-suave sm:w-36">{etiquetaCampo(clave)}:</span>
          <span className="min-w-0 break-words text-[13px] text-texto">
            <ValorDato clave={clave} valor={valor} resolvers={resolvers} />
          </span>
        </div>
      ))}
    </div>
  );
}

function DetalleLegible({ titulo, datos, resolvers }: { titulo: string; datos: unknown; resolvers: Resolvers }) {
  if (datos === null || datos === undefined) return null;
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-borde bg-white p-3.5">
      <div className="mb-2 text-[11px] font-extrabold tracking-wide text-texto-suave">{titulo}</div>
      <ValorDato valor={datos} resolvers={resolvers} />
    </div>
  );
}

export function Auditoria() {
  const { usuario: yo } = useAuth();
  const esAdmin = yo?.rol === 'ADMINISTRADOR';
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: listarUsuarios, enabled: esAdmin });
  // Solo ADMIN puede leer /usuarios — para SOCIO, los xxxId de usuario dentro
  // del detalle quedan sin resolver (fallback al número), pero el nombre del
  // usuario que hizo la acción ya viene embebido en cada registro igual.
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => listarProductos() });
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const resolvers: Resolvers = {
    productos: new Map((productos.data ?? []).map((p) => [p.id, p.nombre])),
    usuarios: new Map((usuarios.data ?? []).map((u) => [u.id, u.nombre])),
    sucursales: new Map((sucursales.data ?? []).map((s) => [s.id, s.nombre])),
  };
  const [expandido, setExpandido] = useState<number | null>(null);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [usuarioId, setUsuarioId] = useState<number | null>(null);
  const [accion, setAccion] = useState('');
  const [entidad, setEntidad] = useState('');

  const registros = useQuery({
    queryKey: ['auditoria', desde, hasta, usuarioId, accion, entidad],
    queryFn: () =>
      listarAuditoria({
        desde: desde || undefined,
        hasta: hasta ? `${hasta}T23:59:59` : undefined,
        usuarioId: usuarioId ?? undefined,
        accion: accion || undefined,
        entidad: entidad || undefined,
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="m-0 flex-1 text-2xl font-extrabold">Auditoría</h1>
        <span className="rounded-lg bg-[#e6e9e2] px-3 py-1.5 text-[13px] font-extrabold text-texto-suave">SOLO LECTURA</span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-11 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        {esAdmin && (
          <select
            value={usuarioId ?? ''}
            onChange={(e) => setUsuarioId(e.target.value ? Number(e.target.value) : null)}
            className="h-11 rounded-[10px] border border-borde-fuerte bg-white px-2.5 text-sm"
          >
            <option value="">Todos los usuarios</option>
            {usuarios.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        )}
        <input value={accion} onChange={(e) => setAccion(e.target.value)} placeholder="Acción exacta (ej: CERRAR_LOTE_PRODUCCION)" className="h-11 w-64 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
        <input value={entidad} onChange={(e) => setEntidad(e.target.value)} placeholder="Entidad exacta (ej: Transferencia)" className="h-11 w-56 rounded-[10px] border border-borde-fuerte px-2.5 text-sm" />
      </div>

      {registros.isLoading && <div className="text-texto-suave">Cargando…</div>}
      {registros.isError && <ErrorDeCarga onReintentar={() => void registros.refetch()} />}
      {registros.data?.length === 0 && <div className="text-texto-suave">No hay registros con estos filtros.</div>}

      <div className="flex flex-col gap-2.5">
        {registros.data?.map((r) => {
          const tieneDetalle = r.datosAnteriores != null || r.datosNuevos != null;
          const abierto = expandido === r.id;
          return (
            <div key={r.id} className="rounded-2xl border border-borde bg-white p-4">
              <button
                type="button"
                onClick={() => tieneDetalle && setExpandido(abierto ? null : r.id)}
                disabled={!tieneDetalle}
                className="grid w-full cursor-pointer grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-2 border-0 bg-transparent p-0 text-left disabled:cursor-default"
              >
                <div>
                  <div className="text-[11px] font-semibold text-texto-suave">FECHA / HORA</div>
                  <div className="text-sm">{fmtFechaHora(r.fechaHora)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-texto-suave">USUARIO</div>
                  <div className="break-words text-sm font-semibold">{r.usuario?.nombre ?? r.usuario?.username ?? '—'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-texto-suave">QUÉ HIZO</div>
                  <div className="break-words text-sm font-bold text-texto">{accionLegible(r.accion)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-texto-suave">SOBRE QUÉ</div>
                  <div className="break-words text-sm text-texto-suave">
                    {r.entidad} #{r.entidadId}
                  </div>
                </div>
                <div className="flex items-end">
                  {tieneDetalle ? (
                    <span className="text-sm font-bold text-primario">{abierto ? '▾ Ocultar detalle' : '▸ Ver detalle'}</span>
                  ) : (
                    <span className="text-sm text-texto-suave">—</span>
                  )}
                </div>
              </button>
              {abierto && tieneDetalle && (
                <div className="mt-3 flex flex-col gap-3 border-t border-[#eef1ea] pt-3 sm:flex-row">
                  <DetalleLegible titulo="ANTES" datos={r.datosAnteriores} resolvers={resolvers} />
                  <DetalleLegible titulo="DESPUÉS" datos={r.datosNuevos} resolvers={resolvers} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
