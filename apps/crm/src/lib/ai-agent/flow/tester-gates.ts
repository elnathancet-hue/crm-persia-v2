// AI Agent — Tester gate warnings.
//
// Backlog #6 Auditoria (mai/2026): rodada 10 #2.
//
// Tester bypassa todos os gates do executor real — feature flag, status
// do agente, horario comercial — pra deixar admin testar configuracoes
// intermediarias antes de publicar. Antes desse fix, tester rodava
// verde mas em prod o executor nem disparava (flag off) ou disparava
// after_hours_message ao inves do fluxo.
//
// Esta funcao colhe os 3 gates como WARNINGS (informacionais, nao
// bloqueiam) e a UI mostra banner amarelo "em prod hoje, esse run
// teria pulado por X".
//
// Falhas de leitura (sem permissao, etc) NAO produzem warning — gate
// silencioso e melhor que false alarm.

import {
  NATIVE_AGENT_FEATURE_FLAG,
  isWithinBusinessHours,
  type HumanizationConfig,
  type OrganizationSettings,
  type TesterLiveResponse,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";

export type GateWarning = NonNullable<TesterLiveResponse["gate_warnings"]>[number];

export async function collectGateWarnings(
  db: AgentDb,
  orgId: string,
  agentStatus: string | undefined,
  humanizationConfig: HumanizationConfig,
  now: Date = new Date(),
): Promise<GateWarning[]> {
  const warnings: GateWarning[] = [];

  // Gate 1: feature flag native_agent_enabled em organizations.settings.
  try {
    const { data: org } = await db
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    const settings = (org as { settings?: OrganizationSettings | null } | null)
      ?.settings;
    const flagOn = settings?.features?.[NATIVE_AGENT_FEATURE_FLAG] === true;
    if (!flagOn) {
      warnings.push({
        code: "feature_flag_off",
        message:
          "Em produção, esse agente não está liberado pra esta organização (feature flag desligada). Tester ignora; prod pularia direto.",
      });
    }
  } catch {
    // silencioso — gate ausente nao deve falhar tester
  }

  // Gate 2: agent_config.status != 'active'. Producao filtra em
  // executor.findEligibleConfig; tester ignora pra deixar admin testar
  // antes de publicar.
  if (agentStatus && agentStatus !== "active") {
    warnings.push({
      code: "agent_not_active",
      message: `Esse agente está em status "${agentStatus}". Em produção, só agentes "active" respondem.`,
    });
  }

  // Gate 3: business hours. Quando enabled e fora do range, prod enviaria
  // after_hours_message ao inves de rodar o fluxo.
  if (humanizationConfig.business_hours_enabled) {
    const inside = isWithinBusinessHours(
      now,
      humanizationConfig.business_hours,
      humanizationConfig.business_hours_timezone,
    );
    if (!inside) {
      warnings.push({
        code: "outside_business_hours",
        message:
          "Agora está fora do horário comercial configurado. Em produção, esse agente mandaria a mensagem de fora-do-horário ao invés de rodar o fluxo.",
      });
    }
  }

  return warnings;
}
