// Formato en español rioplatense: coma decimal, fechas en zona Córdoba.

export function fmtNumero(valor: string | number, maximoDecimales = 3): string {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (Number.isNaN(n)) return String(valor);
  return n.toLocaleString('es-AR', { maximumFractionDigits: maximoDecimales });
}

export function fmtMoneda(valor: string | number): string {
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
