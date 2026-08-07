type Props =
  | { variante: 'ok'; onListo: () => void }
  | { variante: 'diff'; onRecontar: () => void; onSalir: () => void };

// Las 2 pantallas de resultado del conteo: "coincide" (verde, celebratoria)
// vs. "no coincide" (neutral — nunca se culpabiliza al cajero ni se revela de
// qué lado está el error).
//
// El cajero YA NO puede cerrar una recepción que no cuadra: la única salida es
// recontar (reunión 4/8 — "al inicio seamos bien estrictos"). El backend ya
// avisó al encargado en el primer intento fallido; resolver la diferencia es
// decisión del admin.
export function ResultadoRecepcion(props: Props) {
  if (props.variante === 'ok') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4.5 bg-primario px-7 py-7 text-center">
        <div className="animate-pop flex h-30 w-30 items-center justify-center rounded-full bg-white text-6xl font-extrabold text-primario">
          ✓
        </div>
        <div className="text-[30px] font-extrabold text-white">Todo en orden.</div>
        <div className="text-lg text-white/85">Mercadería ingresada.</div>
        <button
          type="button"
          onClick={props.onListo}
          className="mt-2.5 min-h-15 min-w-[220px] cursor-pointer rounded-2xl bg-white text-lg font-extrabold text-primario"
        >
          LISTO
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4.5 px-7 py-7 text-center">
      <div className="flex h-26 w-26 items-center justify-center rounded-full bg-[#e6e9e2] text-[44px] font-bold text-texto-suave">
        ≠
      </div>
      <div className="max-w-[420px] text-[28px] font-extrabold">Los números no coinciden.</div>
      <div className="max-w-[420px] text-lg text-texto-suave">
        Volvé a contar con calma, las veces que necesites. Fijate que no haya quedado algo en la caja o
        en el auto.
      </div>
      <div className="max-w-[420px] rounded-xl bg-advertencia-suave px-4 py-3 text-base font-semibold text-advertencia-texto">
        Ya le avisamos al encargado. Si después de recontar sigue sin dar, dejalo así y avisale — él lo
        resuelve desde el panel.
      </div>
      <div className="mt-2 flex w-full max-w-[380px] flex-col gap-3">
        <button
          type="button"
          onClick={props.onRecontar}
          className="min-h-16 w-full cursor-pointer rounded-2xl bg-primario text-lg font-extrabold text-white hover:bg-primario-hover"
        >
          VOLVER A CONTAR
        </button>
        <button
          type="button"
          onClick={props.onSalir}
          className="min-h-14 w-full cursor-pointer rounded-2xl border-2 border-borde-fuerte bg-white text-base font-bold text-texto-suave hover:border-texto-suave hover:text-texto"
        >
          DEJARLO PARA DESPUÉS
        </button>
      </div>
    </div>
  );
}
