import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Medal } from "lucide-react";

export interface AgentStat {
  userId: string;
  name: string;
  count: number;
}

const MEDAL_COLORS = ["text-yellow-500", "text-zinc-400", "text-amber-700"];

export function TeamPerformance({
  agents,
  period,
}: {
  agents: AgentStat[];
  period: string;
}) {
  const max = agents[0]?.count ?? 1;

  return (
    <Card className="border rounded-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Desempenho da Equipe
          </CardTitle>
          <Medal className="size-4 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">
          {period} — leads captados por agente
        </p>
      </CardHeader>
      <CardContent className="pt-0 pb-2">
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum lead atribuído neste período
          </p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent, i) => (
              <div key={agent.userId} className="flex items-center gap-3">
                <span
                  className={`text-sm font-bold w-5 shrink-0 tabular-nums ${MEDAL_COLORS[i] ?? "text-muted-foreground"}`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {agent.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums ml-2">
                      {agent.count}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.round((agent.count / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
