import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { serializarLote } from '../../src/modules/produccion/produccion.serializers';
import {
  serializarTransferencia,
  puedeVerCantidadEnviada,
} from '../../src/modules/transferencias/transferencias.serializers';

const D = (n: number) => new Prisma.Decimal(n);

// Test de SEGURIDAD (no opcional, CLAUDE.md §10): los campos ciegos jamás
// deben aparecer en el DTO del rol que no puede verlos.

const loteBase = {
  id: 1,
  productoElaboradoId: 12,
  productoElaborado: { nombre: 'Milanesa de nalga' },
  fichaTecnicaVersionId: 3,
  fechaHora: new Date(),
  usuarioOperarioId: 6,
  estado: 'CERRADO',
  unidadesProducidasReales: D(48),
  desperdicioRealKg: D(0.4),
  unidadesEsperadas: D(52),
  desvioPct: D(-7.69),
  alertaDisparada: true,
};

describe('serializarLote — control ciego producción', () => {
  it('PRODUCCION no ve unidadesEsperadas, desvioPct ni alertaDisparada', () => {
    const dto = serializarLote(loteBase, 'PRODUCCION') as Record<string, unknown>;
    expect(dto).not.toHaveProperty('unidadesEsperadas');
    expect(dto).not.toHaveProperty('desvioPct');
    expect(dto).not.toHaveProperty('alertaDisparada');
    expect(dto.unidadesProducidasReales).toBe('48');
  });

  it('ADMINISTRADOR sí ve los campos ciegos', () => {
    const dto = serializarLote(loteBase, 'ADMINISTRADOR') as Record<string, unknown>;
    expect(dto.unidadesEsperadas).toBe('52');
    expect(dto.desvioPct).toBe('-7.69');
    expect(dto.alertaDisparada).toBe(true);
  });

  it('CAJERO tampoco ve campos ciegos', () => {
    const dto = serializarLote(loteBase, 'CAJERO') as Record<string, unknown>;
    expect(dto).not.toHaveProperty('desvioPct');
  });
});

const transferenciaBase = {
  id: 5,
  sucursalOrigenId: 1,
  sucursalOrigen: { nombre: 'Producción Central' },
  sucursalDestinoId: 2,
  sucursalDestino: { nombre: 'Local 1' },
  fechaHoraEnvio: new Date(),
  usuarioEmisorId: 6, // operario producción
  usuarioEmisor: { username: 'produccion' },
  usuarioReceptorId: null,
  usuarioReceptor: null,
  fechaHoraRecepcion: null,
  estado: 'PENDIENTE_RECEPCION',
  lineas: [
    {
      id: 10,
      productoId: 14,
      producto: { nombre: 'Empanada de pollo', unidadDeMedida: 'UNIDAD' },
      cantidadEnviada: D(100),
      cantidadRecibida: null,
      diferencia: null,
    },
  ],
};

describe('serializarTransferencia — recepción ciega', () => {
  it('el receptor (cajero, no emisor) NO ve cantidadEnviada', () => {
    const dto = serializarTransferencia(transferenciaBase, 'CAJERO', 99);
    expect(dto.lineas[0]).not.toHaveProperty('cantidadEnviada');
    expect(dto.lineas[0]).not.toHaveProperty('diferencia');
  });

  it('el emisor SÍ ve cantidadEnviada', () => {
    const dto = serializarTransferencia(transferenciaBase, 'PRODUCCION', 6);
    expect(dto.lineas[0]).toHaveProperty('cantidadEnviada', '100');
  });

  it('ADMINISTRADOR ve cantidadEnviada aunque no sea el emisor', () => {
    const dto = serializarTransferencia(transferenciaBase, 'ADMINISTRADOR', 1);
    expect(dto.lineas[0]).toHaveProperty('cantidadEnviada', '100');
  });

  it('puedeVerCantidadEnviada respeta emisor/admin/socio', () => {
    expect(puedeVerCantidadEnviada({ usuarioEmisorId: 6 }, 'CAJERO', 99)).toBe(false);
    expect(puedeVerCantidadEnviada({ usuarioEmisorId: 6 }, 'PRODUCCION', 6)).toBe(true);
    expect(puedeVerCantidadEnviada({ usuarioEmisorId: 6 }, 'SOCIO', 3)).toBe(true);
  });
});
