interface Props {
  titulo: string;
  subtitulo?: string;
  textoBoton?: string;
  onContinuar: () => void;
  /**
   * Atajo al paso que normalmente viene después. Se muestra ARRIBA del botón
   * principal porque suele ser lo que el operario quiere hacer (pedido de
   * Pablo, reunión 4/8: "recalcar el siguiente paso, iluminarle producir").
   */
  accionSugerida?: { texto: string; onClick: () => void };
}

// Réplica de la pantalla de éxito del diseño: toma de pantalla completa verde
// con check animado. Sin comparaciones, sin colores de bien/mal — solo
// confirma lo que se hizo (control ciego: nunca insinúa esperado vs. real).
export function PantallaExito({
  titulo,
  subtitulo,
  textoBoton = 'LISTO',
  onContinuar,
  accionSugerida,
}: Props) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4.5 bg-primario px-7 py-7 text-center">
      <div className="animate-pop flex h-29 w-29 items-center justify-center rounded-full bg-white text-6xl font-extrabold text-primario">
        ✓
      </div>
      <div className="text-2xl font-extrabold text-white">{titulo}</div>
      {subtitulo && <div className="max-w-[280px] text-lg text-white/85">{subtitulo}</div>}
      {accionSugerida && (
        <button
          type="button"
          onClick={accionSugerida.onClick}
          className="mt-2.5 min-h-[60px] min-w-[200px] cursor-pointer rounded-2xl bg-acento text-lg font-extrabold text-texto"
        >
          {accionSugerida.texto}
        </button>
      )}
      <button
        type="button"
        onClick={onContinuar}
        className={
          accionSugerida
            ? 'min-h-[52px] min-w-[200px] cursor-pointer rounded-2xl border-2 border-white/60 bg-transparent text-base font-bold text-white'
            : 'mt-2.5 min-h-[60px] min-w-[200px] cursor-pointer rounded-2xl bg-white text-lg font-extrabold text-primario'
        }
      >
        {textoBoton}
      </button>
    </div>
  );
}
