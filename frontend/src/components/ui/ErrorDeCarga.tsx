// Estado de error de una consulta.
//
// Por qué existe: con la API caída, las pantallas del admin mostraban su
// encabezado y el cuerpo vacío, sin decir que algo había fallado — o sea que
// "el servidor no responde" y "no hay datos" se veían exactamente igual
// (auditoría 2026-08-07, E-2). Con Neon suspendiendo el compute por
// inactividad, eso no es un caso raro: es lo que ve el admin al abrir la app
// después de un rato.
//
// Lleva botón de reintentar porque el caso típico es justamente transitorio.
export function ErrorDeCarga({
  onReintentar,
  mensaje = 'No se pudieron cargar los datos.',
}: {
  onReintentar?: () => void;
  mensaje?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-error-suave px-3.5 py-3 text-[15px] font-semibold text-error-texto">
      <span className="min-w-0 flex-1">{mensaje}</span>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className="min-h-11 shrink-0 cursor-pointer rounded-xl border-2 border-error-texto/30 bg-white px-4 text-sm font-extrabold text-error-texto"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
