"use server";

import type { TesterRequest, TesterResponse } from "@persia/shared/ai-agent";
import {
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

function getCrmTesterUrl(): string {
  const base = process.env.CRM_CLIENT_BASE_URL;
  if (!base) {
    throw new Error("CRM_CLIENT_BASE_URL não configurada");
  }
  return `${base.replace(/\/$/, "")}/api/ai-agent/tester`;
}

export async function testAgent(orgId: string, req: TesterRequest): Promise<TesterResponse> {
  const { userId } = await requireAdminAgentOrg(orgId);
  const apiSecret = process.env.CRM_API_SECRET;
  if (!apiSecret) {
    throw new Error("CRM_API_SECRET não configurada");
  }

  try {
    const response = await fetch(getCrmTesterUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...req,
        org_id: orgId,
        dry_run: true,
      }),
      cache: "no-store",
    });

    const json = (await response.json()) as TesterResponse & { error?: string };
    if (!response.ok) {
      throw new Error(json.error || "Falha ao testar agente");
    }

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_test",
      entityType: "agent_config",
      entityId: req.config_id,
      metadata: {
        run_id: json.run_id,
        stage_id: req.stage_id ?? null,
        dry_run: true,
      },
    });

    return json;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_test",
      entityType: "agent_config",
      entityId: req.config_id,
      metadata: { stage_id: req.stage_id ?? null, dry_run: true },
      error,
    });
    throw error;
  }
}
