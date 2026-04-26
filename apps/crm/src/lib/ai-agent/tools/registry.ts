import type {
  AgentTool,
  NativeToolPreset,
  NativeHandlerName,
  NativeHandlerRegistry,
} from "@persia/shared/ai-agent";
import { getPreset } from "@persia/shared/ai-agent";
import { addTagHandler } from "./add-tag";
import { movePipelineStageHandler } from "./move-pipeline-stage";
import { stopAgentHandler } from "./stop-agent";
import { transferToAgentHandler } from "./transfer-to-agent";
import { transferToStageHandler } from "./transfer-to-stage";
import { transferToUserHandler } from "./transfer-to-user";
import { triggerNotificationHandler } from "./trigger-notification";

export const nativeHandlers: NativeHandlerRegistry = {
  stop_agent: stopAgentHandler,
  transfer_to_user: transferToUserHandler,
  transfer_to_stage: transferToStageHandler,
  transfer_to_agent: transferToAgentHandler,
  add_tag: addTagHandler,
  trigger_notification: triggerNotificationHandler,
  move_pipeline_stage: movePipelineStageHandler,
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
