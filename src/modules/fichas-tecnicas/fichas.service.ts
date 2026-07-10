import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

export interface IngredienteInput {
  productoInsumoId: number;
  cantidadPorUnidadProducida: number;
  esPrincipal: boolean;
}

export interface VersionInput {
  rendimientoEsperado: number;
  desperdicioEsperadoPct: number;
  umbralDesvioAlertaPct: number;
  ingredientes: IngredienteInput[];
}

function validarIngredientes(ingredientes: IngredienteInput[]) {
  const principales = ingredientes.filter((i) => i.esPrincipal);
  if (principales.length !== 1) {
    throw Errores.validacion('La receta debe tener exactamente UN insumo principal');
  }
}

// Crear ficha técnica con su versión 1. El producto debe ser ELABORADO.
export async function crearFicha(
  productoElaboradoId: number,
  version: VersionInput,
  usuarioId: number,
) {
  validarIngredientes(version.ingredientes);
  const producto = await prisma.producto.findUnique({ where: { id: productoElaboradoId } });
  if (!producto) throw Errores.noEncontrado('Producto');
  if (producto.tipo !== 'ELABORADO') {
    throw Errores.validacion('Solo los productos ELABORADOS llevan ficha técnica');
  }

  return prisma.$transaction(async (tx) => {
    const ficha = await tx.fichaTecnica.create({ data: { productoElaboradoId } });
    const versionCreada = await crearVersionEnTx(tx, ficha.id, 1, version);
    await registrarAuditoria(tx, {
      accion: 'CREAR_FICHA_TECNICA',
      entidad: 'FichaTecnica',
      entidadId: ficha.id,
      usuarioId,
      datosNuevos: { productoElaboradoId, version },
    });
    return { ...ficha, versionActiva: versionCreada };
  });
}

// Modificar receta = crear versión NUEVA + desactivar la anterior.
// NUNCA editar una versión existente (CLAUDE.md §6).
export async function crearNuevaVersion(fichaTecnicaId: number, version: VersionInput, usuarioId: number) {
  validarIngredientes(version.ingredientes);
  const ficha = await prisma.fichaTecnica.findUnique({
    where: { id: fichaTecnicaId },
    include: { versiones: { orderBy: { numeroVersion: 'desc' }, take: 1 } },
  });
  if (!ficha) throw Errores.noEncontrado('Ficha técnica');
  const ultima = ficha.versiones[0];
  const numeroNuevo = (ultima?.numeroVersion ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    // Desactiva TODAS las versiones previas: constraint "una sola activa por ficha"
    await tx.fichaTecnicaVersion.updateMany({
      where: { fichaTecnicaId, activa: true },
      data: { activa: false },
    });
    const versionCreada = await crearVersionEnTx(tx, fichaTecnicaId, numeroNuevo, version);
    await registrarAuditoria(tx, {
      accion: 'NUEVA_VERSION_FICHA_TECNICA',
      entidad: 'FichaTecnicaVersion',
      entidadId: versionCreada.id,
      usuarioId,
      datosAnteriores: ultima
        ? { numeroVersion: ultima.numeroVersion, rendimientoEsperado: ultima.rendimientoEsperado.toString() }
        : null,
      datosNuevos: { numeroVersion: numeroNuevo, ...version },
    });
    return versionCreada;
  });
}

type Tx = Prisma.TransactionClient;

async function crearVersionEnTx(tx: Tx, fichaTecnicaId: number, numeroVersion: number, version: VersionInput) {
  return tx.fichaTecnicaVersion.create({
    data: {
      fichaTecnicaId,
      numeroVersion,
      activa: true,
      rendimientoEsperado: new Prisma.Decimal(version.rendimientoEsperado),
      desperdicioEsperadoPct: new Prisma.Decimal(version.desperdicioEsperadoPct),
      umbralDesvioAlertaPct: new Prisma.Decimal(version.umbralDesvioAlertaPct),
      ingredientes: {
        create: version.ingredientes.map((i) => ({
          productoInsumoId: i.productoInsumoId,
          cantidadPorUnidadProducida: new Prisma.Decimal(i.cantidadPorUnidadProducida),
          esPrincipal: i.esPrincipal,
        })),
      },
    },
    include: { ingredientes: true },
  });
}

export async function listar() {
  return prisma.fichaTecnica.findMany({
    include: {
      productoElaborado: { select: { nombre: true } },
      versiones: {
        include: { ingredientes: { include: { productoInsumo: { select: { nombre: true, unidadDeMedida: true } } } } },
        orderBy: { numeroVersion: 'desc' },
      },
    },
  });
}

export async function obtenerVersionActiva(productoElaboradoId: number) {
  const ficha = await prisma.fichaTecnica.findUnique({
    where: { productoElaboradoId },
    include: {
      versiones: {
        where: { activa: true },
        include: { ingredientes: true },
      },
      productoElaborado: { select: { nombre: true } },
    },
  });
  const version = ficha?.versiones[0];
  if (!ficha || !version) {
    const producto = await prisma.producto.findUnique({ where: { id: productoElaboradoId } });
    throw Errores.fichaSinVersionActiva(producto?.nombre ?? String(productoElaboradoId));
  }
  return { ficha, version };
}
