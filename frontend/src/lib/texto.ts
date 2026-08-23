// Búsqueda tolerante a tildes: "milanesa napolitana" tiene que salir con
// "napolitana" y también con "napolitana" escrito sin acento. Compartida
// entre el buscador de productos (POS) y el de nombre de cliente (Pedidos).
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
