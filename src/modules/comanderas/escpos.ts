// Generación del buffer ESC/POS que se manda crudo a la impresora térmica
// (XPRINTER XP-V320N, 80mm). No usamos librería externa: el subconjunto de
// comandos que necesita una comanda es chico y estable desde hace décadas.
//
// REGLA INNEGOCIABLE (CLAUDE.md §2 y §5 Flujo 4): el ticket NUNCA incluye
// montos de dinero. El de mostrador lo ve el cajero, que por el Control Ciego
// no puede ver importes. Si alguna vez se agrega un campo de precio acá, se
// rompe el principio rector del sistema.

import type { TipoTicket } from '@prisma/client';

// ── Comandos ESC/POS ──
const ESC = 0x1b;
const GS = 0x1d;

const INICIALIZAR = Buffer.from([ESC, 0x40]); // ESC @
const CORTE_PARCIAL = Buffer.from([GS, 0x56, 0x42, 0x00]); // GS V B 0

// La XP-V320N arranca en CP437, que no tiene acentos latinos. CP850 sí, y es
// la que casi todas estas impresoras traen soportada. Si en el hardware real
// salieran caracteres raros, cambiar acá el número de code page (ESC t n) y
// la tabla de MAPA_CP850 de abajo: es el único lugar que hay que tocar.
const CODE_PAGE_CP850 = Buffer.from([ESC, 0x74, 0x02]); // ESC t 2

const alinear = (n: 0 | 1 | 2) => Buffer.from([ESC, 0x61, n]); // 0 izq, 1 centro, 2 der
const negrita = (on: boolean) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
// GS ! n — nibble alto = ancho, nibble bajo = alto. 0x11 = doble en ambos.
const tamano = (n: number) => Buffer.from([GS, 0x21, n]);
const NORMAL = tamano(0x00);
const DOBLE = tamano(0x11);
const LF = Buffer.from([0x0a]);

const ANCHO_COLUMNAS = 48; // 80mm con fuente A

// Caracteres del español en CP850. Lo que no esté acá cae al fallback ASCII:
// preferimos "lena" a un byte basura que la impresora dibuje como símbolo.
const MAPA_CP850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, º: 0xa7, ª: 0xa6,
};

const FALLBACK_ASCII: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U',
  ñ: 'n', Ñ: 'N', ü: 'u', Ü: 'U',
  '¿': '?', '¡': '!', '°': 'o', º: 'o', ª: 'a',
  '—': '-', '–': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'",
};

function codificar(texto: string): Buffer {
  const bytes: number[] = [];
  for (const char of texto) {
    const cp850 = MAPA_CP850[char];
    if (cp850 !== undefined) {
      bytes.push(cp850);
      continue;
    }
    const codigo = char.charCodeAt(0);
    if (codigo < 128) {
      bytes.push(codigo);
      continue;
    }
    for (const c of FALLBACK_ASCII[char] ?? '?') bytes.push(c.charCodeAt(0));
  }
  return Buffer.from(bytes);
}

const linea = (texto = '') => Buffer.concat([codificar(texto), LF]);
const separador = () => linea('-'.repeat(ANCHO_COLUMNAS));

// Parte el texto para que no lo corte la impresora a mitad de palabra.
function envolver(texto: string, ancho = ANCHO_COLUMNAS, sangria = ''): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const anchoUtil = ancho - sangria.length;
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    if (actual.length === 0) actual = palabra;
    else if (actual.length + 1 + palabra.length <= anchoUtil) actual += ` ${palabra}`;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.map((l) => sangria + l);
}

function fechaCordoba(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export interface ItemTicket {
  producto: string;
  cantidad: string;
  aclaraciones?: string | null;
}

// Qué cambió respecto del ticket anterior. CLAUDE.md §5 pide explícitamente
// que un ACTUALIZACION deje ver el cambio, no que repita el pedido entero:
// el cocinero tiene que poder ver de un vistazo qué sumar o sacar.
export interface CambioTicket {
  producto: string;
  clase: 'AGREGADO' | 'QUITADO' | 'CANTIDAD';
  antes?: string;
  ahora?: string;
}

export interface ContenidoTicket {
  pedidoId: number;
  tipo: TipoTicket;
  sucursalId: number;
  sucursal: string;
  tipoPedido: string; // PRESENCIAL | A_RETIRAR
  fechaHora: string; // ISO
  items: ItemTicket[];
  cambios?: CambioTicket[];
}

const ENCABEZADO_TIPO: Record<TipoTicket, string> = {
  NUEVO: 'PEDIDO NUEVO',
  ACTUALIZACION: '** PEDIDO MODIFICADO **',
  ANULACION: '*** PEDIDO ANULADO ***',
};

const LABEL_CAMBIO: Record<CambioTicket['clase'], string> = {
  AGREGADO: '+ AGREGAR',
  QUITADO: '- SACAR',
  CANTIDAD: '~ CAMBIA',
};

export function construirTicket(c: ContenidoTicket): Buffer {
  const partes: Buffer[] = [INICIALIZAR, CODE_PAGE_CP850];

  // ── Encabezado ──
  partes.push(alinear(1));
  partes.push(negrita(true), linea(ENCABEZADO_TIPO[c.tipo]), negrita(false));
  partes.push(linea(c.sucursal));
  partes.push(LF);

  // El Nº de pedido es el identificador que gritan entre mostrador y cocina:
  // va en doble tamaño para poder leerlo de lejos y con las manos ocupadas.
  partes.push(DOBLE, negrita(true), linea(`PEDIDO #${c.pedidoId}`), negrita(false), NORMAL);
  partes.push(linea(c.tipoPedido === 'A_RETIRAR' ? 'PARA RETIRAR' : 'EN EL LOCAL'));
  partes.push(linea(fechaCordoba(c.fechaHora)));

  partes.push(alinear(0));
  partes.push(separador());

  // ── Qué cambió (solo ACTUALIZACION) ──
  if (c.tipo === 'ACTUALIZACION' && c.cambios?.length) {
    partes.push(negrita(true), linea('CAMBIOS:'), negrita(false));
    for (const cambio of c.cambios) {
      const detalle =
        cambio.clase === 'CANTIDAD'
          ? `${cambio.producto} (${cambio.antes} -> ${cambio.ahora})`
          : `${cambio.ahora ?? cambio.antes} ${cambio.producto}`;
      for (const l of envolver(`${LABEL_CAMBIO[cambio.clase]} ${detalle}`, ANCHO_COLUMNAS, '')) {
        partes.push(negrita(true), linea(l), negrita(false));
      }
    }
    partes.push(separador());
    partes.push(linea('PEDIDO COMPLETO QUEDA ASI:'));
  }

  // ── Cuerpo ──
  for (const item of c.items) {
    const texto = `${item.cantidad}x ${item.producto}`;
    const [primera, ...resto] = envolver(texto, ANCHO_COLUMNAS);
    partes.push(negrita(true), linea(primera ?? texto), negrita(false));
    for (const l of resto) partes.push(linea(l));
    if (item.aclaraciones) {
      // La aclaración es lo que más se pasa por alto en cocina: va destacada
      // y con sangría, no como texto corrido pegado al producto.
      for (const l of envolver(`>> ${item.aclaraciones.toUpperCase()}`, ANCHO_COLUMNAS, '   ')) {
        partes.push(negrita(true), linea(l), negrita(false));
      }
    }
  }

  partes.push(separador());

  // ── Pie ──
  if (c.tipo === 'ANULACION') {
    partes.push(alinear(1));
    partes.push(negrita(true), linea('NO PREPARAR'), linea('ESTE PEDIDO SE ANULO'), negrita(false));
    partes.push(alinear(0));
  }

  partes.push(LF, LF, LF);
  partes.push(CORTE_PARCIAL);

  return Buffer.concat(partes);
}

// Compara el pedido anterior contra el nuevo para armar la lista de cambios
// del ticket ACTUALIZACION. Agrupa por nombre de producto (que es lo que ve
// el cocinero); dos líneas del mismo producto con distinta aclaración se
// tratan como una sola entrada, igual que en el ticket.
export function calcularCambios(anteriores: ItemTicket[], actuales: ItemTicket[]): CambioTicket[] {
  const sumarPorProducto = (items: ItemTicket[]) => {
    const mapa = new Map<string, number>();
    for (const i of items) mapa.set(i.producto, (mapa.get(i.producto) ?? 0) + Number(i.cantidad));
    return mapa;
  };

  const antes = sumarPorProducto(anteriores);
  const ahora = sumarPorProducto(actuales);
  const cambios: CambioTicket[] = [];

  for (const [producto, cantidadAhora] of ahora) {
    const cantidadAntes = antes.get(producto);
    if (cantidadAntes === undefined) {
      cambios.push({ producto, clase: 'AGREGADO', ahora: formatearCantidad(cantidadAhora) });
    } else if (cantidadAntes !== cantidadAhora) {
      cambios.push({
        producto,
        clase: 'CANTIDAD',
        antes: formatearCantidad(cantidadAntes),
        ahora: formatearCantidad(cantidadAhora),
      });
    }
  }

  for (const [producto, cantidadAntes] of antes) {
    if (!ahora.has(producto)) {
      cambios.push({ producto, clase: 'QUITADO', antes: formatearCantidad(cantidadAntes) });
    }
  }

  return cambios;
}

function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}
