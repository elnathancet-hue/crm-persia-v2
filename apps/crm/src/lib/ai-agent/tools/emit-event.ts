// AI Agent — handler `emit_event`.
//
// PR-FLOW-PIVOT PR 7 (mai/2026): tool nativa SEM side-effect que serve
// só pra sinalizar pro flow-runner "avance pelo handle X". O runner
// detecta `tool_call.function.name === "emit_event"`, lê o `handle_name`
// do input e segue a edge `sourceHandle: <handle_name>` em vez de
// `tool_success:emit_event`.
//
// Este handler retorna `success: true` sempre — o trabalho real é do
// dispatcher no runner.ts.

import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { failureResult, successResult } from "./shared";

const emitEventSchema = z.object({
  handle_name: z.string().trim().min(1).max(80),
  reason: z.string().nullish(),
});

export const emitEventHandler: NativeHandler = async (_context, input) => {
  const parsed = emitEventSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid emit_event input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return successResult(
    { handle_name: parsed.data.handle_name, reason: parsed.data.reason ?? null },
    [`emitted event: ${parsed.data.handle_name}`],
  );
};
