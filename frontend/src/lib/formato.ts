// Formato en español rioplatense: coma decimal, fechas en zona Córdoba.

// `undefined`/`null` pueden llegar acá desde datos con forma variable (ej.
// el `detalle` JSON de una alerta, que no todos los backends arman igual —
// ver Alertas.tsx). Number.isNaN(undefined) da `false` (no confundir con el
// isNaN global, que sí castea), así que sin este chequeo explícito
// undefined.toLocaleString() tira abajo toda la pantalla sin error boundary.
export function fmtNumero(valor: string | number | null | undefined, maximoDecimales = 3): string {
  if (valor == null) return '—';
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (Number.isNaN(n)) return String(valor);
  return n.toLocaleString('es-AR', { maximumFractionDigits: maximoDecimales });
}

export function fmtMoneda(valor: string | number | null | undefined): string {
  if (valor == null) return '—';
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (Number.isNaN(n)) return String(valor);
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
}

const ZONA = 'America/Argentina/Cordoba';

export function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: ZONA });
}
