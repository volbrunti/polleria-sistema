import { describe, it, expect } from 'vitest';
import { construirTicket, calcularCambios, type ContenidoTicket, type ItemTicket } from '../../src/modules/comanderas/escpos';

const base: ContenidoTicket = {
  pedidoId: 145,
  tipo: 'NUEVO',
  sucursalId: 2,
  sucursal: 'Limón y Chimi',
  tipoPedido: 'PRESENCIAL',
  fechaHora: '2026-08-06T18:30:00.000Z',
  items: [
    { producto: 'Pollo a la leña (entero)', cantidad: '2' },
    { producto: 'Empanada de carne', cantidad: '6', aclaraciones: 'sin sal' },
  ],
};

// El buffer sale en CP850, así que para inspeccionarlo hay que decodificarlo
// igual: leerlo como utf8 rompería los bytes de los acentos.
const comoTexto = (buf: Buffer) => buf.toString('latin1');

describe('construirTicket — invariantes del papel', () => {
  it('NUNCA imprime montos de dinero (Control Ciego §2)', () => {
    // El ticket de mostrador lo ve el cajero, que no puede ver importes. Si
    // alguien agrega un precio al contenido del ticket, esto tiene que romper.
    const texto = comoTexto(construirTicket(base));
    expect(texto).not.toContain('$');
    expect(texto).not.toMatch(/total/i);
    expect(texto).not.toMatch(/precio/i);
    expect(texto).not.toMatch(/\d+[.,]\d{2}\b/); // 1234,56 / 1234.56
  });

  it('el número de pedido va en doble tamaño para leerlo de lejos', () => {
    const buf = construirTicket(base);
    const texto = comoTexto(buf);
    expect(texto).toContain('PEDIDO #145');
    // GS ! 0x11 = doble alto y ancho, justo antes del número
    const dobleTamano = Buffer.from([0x1d, 0x21, 0x11]);
    const posDoble = buf.indexOf(dobleTamano);
    const posNumero = texto.indexOf('PEDIDO #145');
    expect(posDoble).toBeGreaterThan(-1);
    expect(posDoble).toBeLessThan(posNumero);
  });

  it('incluye producto, cantidad y aclaración destacada', () => {
    const texto = comoTexto(construirTicket(base));
    expect(texto).toContain('2x Pollo a la le');
    expect(texto).toContain('6x Empanada de carne');
    expect(texto).toContain('>> SIN SAL');
  });

  it('codifica los acentos en CP850, no en utf8', () => {
    const buf = construirTicket(base);
    // "leña": la ñ tiene que ser UN byte 0xA4 (CP850), no los dos de utf8.
    expect(buf.includes(0xa4)).toBe(true);
    expect(buf.includes(Buffer.from('ñ', 'utf8'))).toBe(false);
    // Y el ticket declara la code page antes de escribir (ESC t 2)
    expect(buf.indexOf(Buffer.from([0x1b, 0x74, 0x02]))).toBeGreaterThan(-1);
  });

  it('arranca inicializando la impresora y termina cortando el papel', () => {
    const buf = construirTicket(base);
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // ESC @
    expect(buf.subarray(-4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V B 0
  });

  it('distingue el pedido para retirar del que se come en el local', () => {
    expect(comoTexto(construirTicket(base))).toContain('EN EL LOCAL');
    expect(comoTexto(construirTicket({ ...base, tipoPedido: 'A_RETIRAR' }))).toContain('PARA RETIRAR');
  });

  it('la anulación grita que no se prepare', () => {
    const texto = comoTexto(construirTicket({ ...base, tipo: 'ANULACION' }));
    expect(texto).toContain('PEDIDO ANULADO');
    expect(texto).toContain('NO PREPARAR');
  });

  it('un producto de nombre largo se corta por palabra, no a la mitad', () => {
    const texto = comoTexto(
      construirTicket({
        ...base,
        items: [{ producto: 'Sandwich de milanesa completo con papas fritas y huevo', cantidad: '1' }],
      }),
    );
    // Ninguna línea supera el ancho del papel (48 col en 80mm). Hay que sacar
    // los comandos ESC/POS con su largo exacto: si se descartan a ojo quedan
    // bytes de argumento sueltos y el conteo da de más.
    // eslint-disable-next-line no-control-regex
    const SIN_COMANDOS = /\x1b@|\x1b[taE][\s\S]|\x1d![\s\S]|\x1dVB\x00/g;
    for (const l of texto.split('\n')) {
      expect(l.replace(SIN_COMANDOS, '').length).toBeLessThanOrEqual(48);
    }
    expect(texto).toContain('Sandwich');
    expect(texto).toContain('fritas');
  });
});

describe('calcularCambios — qué ve el cocinero en un ACTUALIZACION', () => {
  const item = (producto: string, cantidad: string): ItemTicket => ({ producto, cantidad });

  it('detecta un producto agregado', () => {
    const cambios = calcularCambios([item('Milanesa', '2')], [item('Milanesa', '2'), item('Papas', '1')]);
    expect(cambios).toEqual([{ producto: 'Papas', clase: 'AGREGADO', ahora: '1' }]);
  });

  it('detecta un producto quitado', () => {
    const cambios = calcularCambios([item('Milanesa', '2'), item('Papas', '1')], [item('Milanesa', '2')]);
    expect(cambios).toEqual([{ producto: 'Papas', clase: 'QUITADO', antes: '1' }]);
  });

  it('detecta un cambio de cantidad con el antes y el después', () => {
    const cambios = calcularCambios([item('Empanada', '6')], [item('Empanada', '12')]);
    expect(cambios).toEqual([{ producto: 'Empanada', clase: 'CANTIDAD', antes: '6', ahora: '12' }]);
  });

  it('no informa cambios si el pedido quedó igual', () => {
    expect(calcularCambios([item('Milanesa', '2')], [item('Milanesa', '2')])).toEqual([]);
  });

  it('suma las líneas repetidas del mismo producto antes de comparar', () => {
    // Dos líneas de milanesa con aclaraciones distintas son 3 milanesas para
    // la cocina: el cambio se calcula sobre el total, no línea por línea.
    const cambios = calcularCambios(
      [{ producto: 'Milanesa', cantidad: '1', aclaraciones: 'sin sal' }, item('Milanesa', '2')],
      [item('Milanesa', '3')],
    );
    expect(cambios).toEqual([]);
  });

  it('formatea las cantidades fraccionarias con coma (medio pollo)', () => {
    const cambios = calcularCambios([], [item('Pollo a la leña (medio)', '0.5')]);
    expect(cambios).toEqual([
      { producto: 'Pollo a la leña (medio)', clase: 'AGREGADO', ahora: '0,5' },
    ]);
  });
});

describe('el ticket de ACTUALIZACION muestra el cambio, no solo el pedido nuevo', () => {
  it('imprime el bloque de CAMBIOS antes del pedido completo', () => {
    const texto = comoTexto(
      construirTicket({
        ...base,
        tipo: 'ACTUALIZACION',
        items: [{ producto: 'Empanada de carne', cantidad: '12' }],
        cambios: [{ producto: 'Empanada de carne', clase: 'CANTIDAD', antes: '6', ahora: '12' }],
      }),
    );
    expect(texto).toContain('PEDIDO MODIFICADO');
    expect(texto).toContain('CAMBIOS:');
    expect(texto).toContain('~ CAMBIA Empanada de carne (6 -> 12)');
    expect(texto).toContain('PEDIDO COMPLETO QUEDA AS');
    expect(texto.indexOf('CAMBIOS:')).toBeLessThan(texto.indexOf('PEDIDO COMPLETO'));
  });
});
