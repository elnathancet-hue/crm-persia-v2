import type {
  FlowActionType,
  FlowConditionType,
  FlowConfig,
  FlowEntryNode,
} from "./flow";
import { findOutgoingEdges } from "./flow";

export type FlowValidationSeverity = "error" | "warning";

export interface FlowValidationIssue {
  code: string;
  severity: FlowValidationSeverity;
  message: string;
  node_id?: string;
  edge_id?: string;
}

function actionConfigIssue(
  actionType: FlowActionType,
  config: Record<string, unknown>,
): string | null {
  switch (actionType) {
    case "add_tag":
    case "remove_tag":
      return String(config.tag_name ?? "").trim()
        ? null
        : "Falta selecionar uma tag.";
    case "move_pipeline_stage":
      return String(config.stage_name ?? "").trim()
        ? null
        : "Falta escolher a etapa de destino.";
    case "trigger_notification":
      return String(config.template_name ?? "").trim()
        ? null
        : "Falta escolher o template de notificacao.";
    case "send_media":
      return String(config.slug ?? "").trim()
        ? null
        : "Falta escolher a midia.";
    case "transfer_to_user":
      return String(config.user ?? "").trim()
        ? null
        : "Falta escolher o atendente.";
    case "transfer_to_agent":
      return String(config.target_agent_name ?? "").trim()
        ? null
        : "Falta escolher o agente de destino.";
    case "set_lead_custom_field":
      return String(config.field_key ?? "").trim()
        ? null
        : "Falta escolher o campo personalizado.";
    case "send_whatsapp_message":
      return String(config.message ?? "").trim()
        ? null
        : "Falta escrever a mensagem.";
    case "create_appointment":
    case "stop_agent":
    case "round_robin_user":
      return null;
  }
}

function conditionConfigIssue(
  conditionType: FlowConditionType,
  config: Record<string, unknown>,
): string | null {
  switch (conditionType) {
    case "has_tag":
      return String(config.tag_name ?? "").trim()
        ? null
        : "Falta escolher a tag da verificacao.";
    case "lead_custom_field_equals":
      return String(config.field_name ?? "").trim()
        ? null
        : "Falta escolher o campo da verificacao.";
    case "in_segment":
      return String(config.segment_id ?? "").trim()
        ? null
        : "Falta escolher a segmentacao.";
  }
}

function isCrmEventEntry(entry: FlowEntryNode): boolean {
  return (
    entry.data.trigger === "segment_entered" ||
    entry.data.trigger === "pipeline_stage_entered"
  );
}

export function validateFlowConfig(flow: FlowConfig): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const entryNodes = flow.nodes.filter(
    (node): node is FlowEntryNode => node.type === "entry",
  );

  if (entryNodes.length === 0) {
    issues.push({
      code: "missing_entry",
      severity: "error",
      message: "Adicione uma entrada para o fluxo poder disparar.",
    });
  }

  if (entryNodes.length > 1) {
    issues.push({
      code: "multiple_entries",
      severity: "error",
      message:
        "Este runtime executa uma entrada por fluxo. Use apenas uma entrada e crie outro agente/fluxo para outro gatilho.",
    });
  }

  if (flow.nodes.length > 0 && flow.nodes.every((node) => node.type === "entry")) {
    issues.push({
      code: "entry_only",
      severity: "error",
      message: "Conecte a entrada a uma IA ou acao para o fluxo fazer algo.",
      node_id: entryNodes[0]?.id,
    });
  }

  for (const entry of entryNodes) {
    const defaultEdges = findOutgoingEdges(flow, entry.id, "default");
    if (defaultEdges.length === 0) {
      issues.push({
        code: "entry_without_next",
        severity: "error",
        message: "A entrada precisa estar conectada ao proximo passo.",
        node_id: entry.id,
      });
    }

    if (isCrmEventEntry(entry)) {
      for (const edge of defaultEdges) {
        const target = nodesById.get(edge.target);
        if (target?.type === "ai_agent") {
          // PR-4 Auditoria (mai/2026): elevado de warning pra error.
          // Endereca rodada 3 #5 — entry de evento CRM (pipeline_stage_entered,
          // segment_entered) gera inboundMessage.text vazio. AI node skipa
          // a chamada ao modelo e segue edge default. Sem default edge ou
          // sem action node, flow morre silenciosamente sem o lead receber
          // nada. UX: cliente desenha "entrou na etapa -> IA", salva,
          // ativa, e a IA nunca fala — bug confuso. Bloquear save aqui
          // forca o cliente a inserir uma acao proativa entre o evento
          // e a IA (ex: send_whatsapp_message "Oi, vi que voce mudou de
          // etapa, posso ajudar?").
          issues.push({
            code: "crm_event_to_ai",
            severity: "error",
            message:
              "Eventos do CRM nao trazem mensagem do lead. Comece com uma acao (ex: Enviar WhatsApp) antes da IA — senao a IA nao tem o que responder.",
            node_id: target.id,
            edge_id: edge.id,
          });
        }
      }
    }
  }

  for (const node of flow.nodes) {
    if (node.type !== "entry") {
      const hasIncoming = flow.edges.some((edge) => edge.target === node.id);
      if (!hasIncoming) {
        issues.push({
          code: "orphan_node",
          severity: "warning",
          message: "Esta tarefa nao recebe conexao de nenhuma etapa anterior.",
          node_id: node.id,
        });
      }
    }

    if (node.type === "action") {
      const message = actionConfigIssue(node.data.action_type, node.data.config);
      if (message) {
        issues.push({
          code: "action_incomplete",
          severity: "error",
          message,
          node_id: node.id,
        });
      }
    }

    if (node.type === "condition") {
      const message = conditionConfigIssue(
        node.data.condition_type,
        node.data.config,
      );
      if (message) {
        issues.push({
          code: "condition_incomplete",
          severity: "error",
          message,
          node_id: node.id,
        });
      }

      for (const handle of ["yes", "no"] as const) {
        if (findOutgoingEdges(flow, node.id, handle).length === 0) {
          issues.push({
            code: `condition_missing_${handle}`,
            severity: "warning",
            message:
              handle === "yes"
                ? "O caminho Sim nao esta conectado; se a regra passar, o fluxo termina aqui."
                : "O caminho Nao nao esta conectado; se a regra falhar, o fluxo termina aqui.",
            node_id: node.id,
          });
        }
      }
    }
  }

  for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    if (!source) continue;
    const handle = edge.sourceHandle || "default";
    let valid = true;
    if (source.type === "entry" || source.type === "action") {
      valid = handle === "default";
    } else if (source.type === "condition") {
      valid = handle === "yes" || handle === "no";
    } else if (source.type === "ai_agent") {
      const instructionHandles = new Set(
        source.data.instructions.map((instruction) => instruction.output_handle),
      );
      valid = handle === "default" || instructionHandles.has(handle);
    }

    if (!valid) {
      issues.push({
        code: "invalid_edge_handle",
        severity: "warning",
        message: "Esta conexao sai de um caminho que nao existe mais.",
        node_id: source.id,
        edge_id: edge.id,
      });
    }
  }

  return issues;
}
