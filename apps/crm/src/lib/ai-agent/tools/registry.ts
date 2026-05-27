import type {
  AgentTool,
  NativeToolPreset,
  NativeHandlerName,
  NativeHandlerRegistry,
} from "@persia/shared/ai-agent";
import { getPreset } from "@persia/shared/ai-agent";
import { addTagHandler } from "./add-tag";
import { cancelAppointmentHandler } from "./cancel-appointment";
import { createAppointmentHandler } from "./create-appointment";
import { emitEventHandler } from "./emit-event";
import { listLeadAppointmentsHandler } from "./list-lead-appointments";
import { movePipelineStageHandler } from "./move-pipeline-stage";
import { removeTagHandler } from "./remove-tag";
import { rescheduleAppointmentHandler } from "./reschedule-appointment";
import { roundRobinUserHandler } from "./round-robin-user";
import { sendMediaHandler } from "./send-media";
import { setLeadCustomFieldHandler } from "./set-lead-custom-field";
import { stopAgentHandler } from "./stop-agent";
import { transferToAgentHandler } from "./transfer-to-agent";
// PR-FLOW-PIVOT (mai/2026): transferToStageHandler deletado. Substituído
// por edges nomeadas do canvas (handles do node IA disparam saídas
// determinísticas).
import { transferToUserHandler } from "./transfer-to-user";
import { triggerNotificationHandler } from "./trigger-notification";

export const nativeHandlers: NativeHandlerRegistry = {
  stop_agent: stopAgentHandler,
  transfer_to_user: transferToUserHandler,
  transfer_to_agent: transferToAgentHandler,
  add_tag: addTagHandler,
  // PR-6 Auditoria (mai/2026): handler novo. Espelha add_tag mas DELETE.
  remove_tag: removeTagHandler,
  trigger_notification: triggerNotificationHandler,
  move_pipeline_stage: movePipelineStageHandler,
  // PR-AGENDA-TOOLS (mai/2026): agendamento conversacional via WhatsApp
  create_appointment: createAppointmentHandler,
  list_lead_appointments: listLeadAppointmentsHandler,
  cancel_appointment: cancelAppointmentHandler,
  reschedule_appointment: rescheduleAppointmentHandler,
  // PR-AI-AGENT-HUMAN-D (mai/2026): envio de midia da biblioteca
  send_media: sendMediaHandler,
  // PR-FLOW-PIVOT PR 7 (mai/2026): tool sem side-effect — sinaliza pro
  // flow-runner avançar pelo handle nomeado do AI node. Runner detecta
  // pelo tool_call.function.name + lê handle_name do input.
  emit_event: emitEventHandler,
  // PR-FLOW-PIVOT PR 8 (mai/2026): IA escreve em lead_custom_field_values.
  // Paridade com `edit_lead_ia` do flow.json do Jordan.
  set_lead_custom_field: setLeadCustomFieldHandler,
  // PR-FLOW-PIVOT PR 13 (mai/2026): distribuição automática de leads
  // (algoritmo least-loaded). Paridade com queue/round-robin do
  // flow.json do Jordan.
  round_robin_user: roundRobinUserHandler,
};

export function isImplementedNativeHandler(
  handler: NativeHandlerName | null,
): handler is keyof typeof nativeHandlers {
  return !!handler && handler in nativeHandlers;
}

export function getDefaultStopAgentTool(params: {
  configId: string;
  organizationId: string;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  return materializePresetTool({
    configId: params.configId,
    organizationId: params.organizationId,
    preset: requirePreset("stop_agent"),
  });
}

export function materializePresetTool(params: {
  configId: string;
  organizationId: string;
  preset: NativeToolPreset;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  return {
    config_id: params.configId,
    organization_id: params.organizationId,
    name: params.preset.name,
    description: params.preset.description,
    input_schema: params.preset.input_schema,
    execution_mode: "native",
    native_handler: params.preset.handler,
    webhook_url: null,
    webhook_secret: null,
    is_enabled: true,
  };
}

function requirePreset(handler: NativeHandlerName): NativeToolPreset {
  const preset = getPreset(handler);
  if (!preset) {
    throw new Error(`Missing native tool preset for ${handler}`);
  }
  return preset;
}
