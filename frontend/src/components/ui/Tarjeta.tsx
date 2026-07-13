import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function Tarjeta({ className = '', children, ...resto }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-borde bg-white p-4 ${className}`} {...resto}>
      {children}
    </div>
  );
}

export function TarjetaBoton({
  className = '',
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={`w-full min-h-[58px] rounded-2xl border-2 border-borde bg-white px-5 py-3.5 text-left font-bold text-texto cursor-pointer transition-colors hover:border-primario ${className}`}
      {...resto}
    >
      {children}
    </button>
  );
}
