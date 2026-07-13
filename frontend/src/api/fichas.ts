import { apiFetch } from './client';
import type { FichaTecnica, FichaTecnicaVersion } from './types';

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

export function listarFichas() {
  return apiFetch<FichaTecnica[]>('/api/fichas-tecnicas');
}

export function crearFicha(productoElaboradoId: number, version: VersionInput) {
  return apiFetch<FichaTecnica>('/api/fichas-tecnicas', {
    method: 'POST',
    body: { productoElaboradoId, version },
  });
}

export function crearNuevaVersion(fichaId: number, version: VersionInput) {
  return apiFetch<FichaTecnicaVersion>(`/api/fichas-tecnicas/${fichaId}/versiones`, {
    method: 'POST',
    body: version,
  });
}
