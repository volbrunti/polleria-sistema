import { useState } from 'react';
import { fmtNumero } from '../../lib/formato';

export interface PropsTecladoNumerico {
  titulo: string;
  subtitulo?: string;
  unidad?: string;
  permiteDecimal?: boolean;
  permiteCero?: boolean;
  maximo?: number;
  mensajeMaximo?: string;
  onConfirmar: (valor: number) => void;
  onCancelar: () => void;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'];

// Réplica del overlay "teclado numérico" del diseño: bottom sheet en mobile,
// modal centrado en desktop. Estilo calculadora — pensado para manos
// ocupadas/sucias (CLAUDE.md: botones enormes, sin teclado físico).
export function TecladoNumerico({
  titulo,
  subtitulo,
  unidad,
  permiteDecimal = true,
  permiteCero = false,
  maximo,
  mensajeMaximo,
  onConfirmar,
  onCancelar,
}: PropsTecladoNumerico) {
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');

  function presionar(tecla: string) {
    setError('');
    if (tecla === '⌫') {
      setValor((v) => v.slice(0, -1));
    } else if (tecla === ',') {
      if (permiteDecimal && !valor.includes(',')) setValor((v) => (v || '0') + ',');
    } else if (valor.replace(',', '').length < 6) {
      setValor((v) => v + tecla);
    }
  }

  function confirmar() {
    const n = parseFloat(valor.replace(',', '.'));
    if (!valor || Number.isNaN(n)) return setError('Cargá un número.');
    if (n <= 0 && !permiteCero) return setError('Tiene que ser mayor que 0.');
    if (n < 0) return setError('Tiene que ser 0 o más.');
    if (maximo != null && n > maximo) return setError(mensajeMaximo ?? `No puede superar ${fmtNumero(maximo)}.`);
    onConfirmar(n);
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div className="flex w-full flex-col gap-3 rounded-t-3xl bg-white p-5 sm:w-full sm:max-w-md sm:rounded-3xl">
        <div className="text-lg font-extrabold">{titulo}</div>
        {subtitulo && <div className="-mt-2 text-sm text-texto-suave">{subtitulo}</div>}
        <div className="flex min-h-[64px] items-baseline justify-end gap-2 rounded-2xl border-2 border-borde-fuerte bg-panel px-4 py-3.5">
          <span className="text-4xl font-extrabold tracking-wide">{valor || '0'}</span>
          {unidad && <span className="text-lg font-semibold text-texto-suave">{unidad}</span>}
        </div>
        {error && <div className="rounded-xl bg-error-suave px-3.5 py-3 text-base font-bold text-error-texto">{error}</div>}
        <div className="grid grid-cols-3 gap-2">
          {TECLAS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => presionar(k)}
              className="min-h-[60px] cursor-pointer rounded-xl border border-borde bg-panel text-2xl font-bold text-texto hover:bg-chip active:bg-borde"
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancelar}
            className="min-h-[60px] flex-1 cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            className="min-h-[60px] flex-[2] cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
          >
            CONFIRMAR
          </button>
        </div>
      </div>
    </div>
  );
}
