"use client";

/**
 * Error Boundary racine de l'UI CRM.
 *
 * Sans lui, toute exception d'un composant client remonte au boundary interne
 * de Next → écran générique « Application error: a client-side exception has
 * occurred » (blanc, sans aucune info). Ici :
 * - on logge l'erreur AVEC le componentStack via console.error → capté par la
 *   télémétrie desktop (console-message + window.onerror → collecteur) ;
 * - on affiche un écran d'erreur exploitable (message + bouton recharger).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // console.error → console-message "error" → log main + rapport collecteur.
    // Le componentStack identifie le composant fautif même en prod minifiée.
    console.error(
      `[tf2-error-boundary] ${error.message}\ncomponentStack:${info.componentStack ?? "(inconnu)"}\nstack:${error.stack ?? ""}`,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-semibold text-slate-900">
            Une erreur est survenue dans l&apos;interface
          </h1>
          <p className="max-w-md break-words text-sm text-slate-500">
            {this.state.error.message}
          </p>
          <p className="max-w-md text-xs text-slate-400">
            L&apos;incident a été enregistré et transmis automatiquement.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Recharger l&apos;application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
