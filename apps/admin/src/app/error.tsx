"use client";

import { Button } from "@persia/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
        <div>
          <p className="font-semibold text-lg">Algo deu errado</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error.message || "Erro inesperado. Tente novamente."}
          </p>
        </div>
        <Button onClick={reset} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
