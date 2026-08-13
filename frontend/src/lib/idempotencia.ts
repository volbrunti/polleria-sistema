// Token que acompaña a una operación de escritura para que un reintento no la
// duplique. El backend lo guarda con un unique y, si le llega uno repetido,
// devuelve el registro original en vez de crear otro.
//
// Vive un token por "operación que el usuario empezó", no por request: si se
// generara uno nuevo en cada llamada, un reintento automático de React Query o
// un segundo toque del cajero crearían dos registros y no habría forma de
// distinguirlos de dos operaciones legítimas iguales.
//
// crypto.randomUUID solo existe en contexto seguro (HTTPS o localhost). Hoy la
// app se sirve por HTTPS, pero si alguna vez se abre por IP en la LAN del local
// —que es exactamente el escenario de una tablet en el mostrador— sin este
// fallback la pantalla reventaría al montar en vez de perder solo el token.
export function nuevoToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
