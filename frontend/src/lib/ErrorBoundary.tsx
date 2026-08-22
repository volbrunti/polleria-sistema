import { Component, type ErrorInfo, type ReactNode } from 'react';

// React desmonta TODO el árbol si un error de render escapa sin capturar. Sin
// un boundary, un solo campo inesperado en una pantalla dejaba la app en
// blanco: sin sidebar, sin menú, sin forma de navegar a otro lado. Ya pasó una
// vez con la pantalla de Alertas (ver el comentario de `fmtNumero` en
// formato.ts, que menciona explícitamente "sin error boundary").
//
// Se usa en dos niveles:
//  - por ruta (ShellAdmin): si revienta una sección, el resto sigue navegable.
//  - raíz (main.tsx): red de contención para todo lo que no pasa por el panel
//    admin — el POS de CAJERO/ENCARGADO y las pantallas de PRODUCCION.

interface Props {
  children: ReactNode;
  /** Nombre de la sección, para el mensaje al usuario y para el log. */
  nombre?: string;
  /** Cambiá este valor (ej. la ruta actual) para limpiar el error al navegar. */
  claveReset?: string;
}

interface State {
  error: Error | null;
  /** Última `claveReset` vista, para detectar la navegación. */
  claveReset?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  // Al navegar a otra sección se limpia el error; si no, el boundary queda
  // "pegado" mostrando la pantalla de falla aunque el usuario ya se fue.
  // Va acá y no en `componentDidUpdate` para no encadenar un segundo render
  // (y porque `setState` en `componentDidUpdate` es un antipatrón).
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.claveReset !== state.claveReset) {
      return { claveReset: props.claveReset, error: null };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.nombre ? ` ${this.props.nombre}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  private reintentar = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="rounded-2xl border border-borde bg-white p-6">
        <div className="text-lg font-extrabold text-error">
          No se pudo mostrar {this.props.nombre ?? 'esta sección'}.
        </div>
        <div className="mt-1.5 text-sm text-texto-suave">
          Hubo un problema al dibujar la pantalla. El resto del sistema sigue funcionando; podés
          seguir navegando desde el menú.
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[#f2f4ee] p-3 text-xs text-texto-suave">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.reintentar}
          className="mt-3 min-h-11 cursor-pointer rounded-[10px] border border-borde-fuerte bg-white px-4 text-sm font-bold text-primario hover:bg-chip"
        >
          Reintentar
        </button>
      </div>
    );
  }
}
