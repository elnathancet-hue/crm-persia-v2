// PR-AI-AGENT-STAGE-ACTIONS-UI (mai/2026): tipos do UI que nao saem
// do pacote (helpers internos + contratos com server actions). Espelha
// `apps/crm/src/actions/ai-agent/stage-action-config.ts:StageActionCatalogs`.

export interface StageActionCatalogs {
  tags: Array<{ name: string; description: string | null; color: string | null }>;
  members: Array<{ name: string; email: string | null }>;
  agents: Array<{ id: string; name: string; description: string | null }>;
  kanbanPipelines: Array<{
    id: string;
    name: string;
    stages: Array<{
      name: string;
      outcome: "em_andamento" | "falha" | "bem_sucedido";
    }>;
  }>;
  media: Array<{ slug: string; name: string; category: string }>;
  notificationTemplates: Array<{ name: string; description: string | null }>;
  appointmentTypes: Array<{
    slug: string;
    name: string;
    duration_minutes: number;
  }>;
}
