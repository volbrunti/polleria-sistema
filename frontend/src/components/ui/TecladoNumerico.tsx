import { useState, type ReactNode } from 'react';
import { fmtNumero } from '../../lib/formato';

export interface PropsTecladoNumerico {
  titulo: string;
  subtitulo?: string;
  unidad?: string;
  permiteDecimal?: boolean;
  permiteCero?: boolean;
  maximo?: number;
  mensajeMaximo?: string;
  /**
   * Contenido fijo siempre visible (ej: "Quedan 8,2 kg disponibles") — no
   * depende de que se pase el máximo. Acepta JSX para poder desglosar el saldo
   * partida por partida en vez de mostrar solo el total.
   */
  pistaDisponible?: ReactNode;
  /** Prefill al editar un valor ya cargado. */
  valorInicial?: number;
  /**
   * "contraste" pinta el teclado en ámbar en vez de verde. Se usa cuando dos
   * teclados aparecen uno atrás del otro y el operario podría no registrar que
   * cambió de paso — el caso que motivó esto es remito → peso real, donde
   * repetir el número del remito por inercia arruina el control (pedido de
   * Pablo, reunión 4/8: "no te genera ninguna diferencia visual").
   */
  variante?: 'normal' | 'contraste';
  /** Ícono grande al lado del título. Refuerza de qué paso se trata. */
  icono?: string;
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
  pistaDisponible,
  valorInicial,
  variante = 'normal',
  icono,
  onConfirmar,
  onCancelar,
}: PropsTecladoNumerico) {
  const contraste = variante === 'contraste';
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial).replace('.', ',') : '');
  const [error, setError] = useState('');

  function presionar(tecla: string) {
    setError('');
    if (tecla === '⌫') {
      setValor((v) => v.slice(0, -1));
    } else if (tecla === ',') {
      if (permiteDecimal && !valor.includes(',')) setValor((v) => (v || '0') + ',');
    } else if (valor.replace(',', '').length < 6) {
      // Si queda un "0" solo (típico tras un error de validación sin
      // limpiar el campo), el próximo dígito lo reemplaza en vez de
      // concatenarse — si no, "0" + "2" + "0" queda "020" en vez de "20"
      // (hallazgo de la revisión del 19/8, rol Producción).
      setValor((v) => (v === '0' ? tecla : v + tecla));
    }
  }

  function confirmar() {
    // Con permiteCero, el visor ya muestra "0" de entrada ({valor || '0'})
    // aunque el operario no haya tocado ninguna tecla — pedirle que además
    // escriba el "0" para poder confirmar es una trampa (hallazgo de la
    // revisión del 19/8, típico en "desperdicio: puede ser 0").
    const crudo = valor === '' && permiteCero ? '0' : valor;
    const n = parseFloat(crudo.replace(',', '.'));
    if (!crudo || Number.isNaN(n)) return setError('Cargá un número.');
    if (n <= 0 && !permiteCero) return setError('Tiene que ser mayor que 0.');
    if (n < 0) return setError('Tiene que ser 0 o más.');
    if (maximo != null && n > maximo) return setError(mensajeMaximo ?? `No puede superar ${fmtNumero(maximo)}.`);
    onConfirmar(n);
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center sm:p-6">
      <div
        className={`flex w-full flex-col gap-3 rounded-t-3xl bg-white p-5 sm:w-full sm:max-w-md sm:rounded-3xl ${
          contraste ? 'border-t-8 border-acento sm:border-t-0 sm:ring-8 sm:ring-acento' : ''
        }`}
      >
        <div className="flex items-start gap-2.5">
          {icono && <span className="text-2xl leading-none">{icono}</span>}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-extrabold">{titulo}</div>
            {subtitulo && <div className="text-sm text-texto-suave">{subtitulo}</div>}
          </div>
        </div>
        {pistaDisponible && (
          <div
            className={
              contraste
                ? '-mt-1 rounded-xl bg-advertencia-suave px-3.5 py-2.5 text-[15px] font-bold text-advertencia-texto'
                : '-mt-1 rounded-xl bg-chip px-3.5 py-2 text-sm font-semibold text-texto-suave'
            }
          >
            {pistaDisponible}
          </div>
        )}
        <div
          className={`flex min-h-[64px] items-baseline justify-end gap-2 rounded-2xl border-2 px-4 py-3.5 ${
            contraste ? 'border-acento bg-advertencia-suave' : 'border-borde-fuerte bg-panel'
          }`}
        >
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
