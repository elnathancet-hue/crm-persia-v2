import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

export function LegacyBanner({ featureName }: { featureName: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-warning-foreground">Sistema antigo</span>
        <span className="text-muted-foreground ml-1.5">
          {featureName} faz parte da versão legada. O Agente IA substitui esta funcionalidade com mais recursos e confiabilidade.
        </span>
      </div>
      <Link
        href="/automations/agents"
        className="flex items-center gap-1 shrink-0 text-xs font-medium text-primary hover:underline"
      >
        Usar Agente IA
        <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
