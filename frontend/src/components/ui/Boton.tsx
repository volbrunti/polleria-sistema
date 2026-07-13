import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  grande?: boolean;
  children: ReactNode;
}

const BASE = 'rounded-2xl font-extrabold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-primario text-white hover:bg-primario-hover',
  secundario: 'bg-white border-2 border-borde-fuerte text-texto hover:border-primario',
  peligro: 'bg-white border border-red-200 text-error hover:bg-error-suave',
  fantasma: 'bg-transparent text-primario hover:bg-chip font-semibold',
};

export function Boton({ variante = 'primario', grande = true, className = '', children, ...resto }: Props) {
  const tamano = grande ? 'min-h-[60px] px-6 text-lg' : 'min-h-[44px] px-4 text-sm';
  return (
    <button className={`${BASE} ${VARIANTES[variante]} ${tamano} ${className}`} {...resto}>
      {children}
    </button>
  );
}
