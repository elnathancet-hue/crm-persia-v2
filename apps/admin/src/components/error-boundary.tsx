"use client";

import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
    this.props.onError?.(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <AlertCircle className="size-10 mx-auto text-red-500" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Algo deu errado</h2>
          <p className="text-sm text-muted-foreground break-words">{error.message || "Erro inesperado"}</p>
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="size-4" />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
}
