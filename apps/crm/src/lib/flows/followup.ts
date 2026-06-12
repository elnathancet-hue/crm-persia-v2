import { createClient } from "@supabase/supabase-js";
import { resumeExecution } from "./engine";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Processes scheduled follow-ups.
 * Finds all flow_executions with status "waiting" and data.resume_at <= now,
 * then resumes each one.
 */
export async function processFollowUps(): Promise<{
  processed: number;
  errors: number;
}> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Filtra no banco pelo campo JSONB metadata->>'resume_at' <= now,
  // evitando buscar todas as "waiting" e descartar no cliente.
  // Ordena por resume_at pra processar as mais atrasadas primeiro.
  const { data: dueExecutions, error } = await supabase
    .from("flow_executions")
    .select("id, metadata")
    .eq("status", "waiting")
    .not("metadata->resume_at", "is", null)
    .lte("metadata->resume_at", now)
    .order("metadata->resume_at", { ascending: true })
    .limit(50);

  if (error || !dueExecutions) {
    console.error("[FollowUp] Error fetching executions:", error?.message);
    return { processed: 0, errors: 1 };
  }

  let processed = 0;
  let errors = 0;

  for (const exec of dueExecutions) {
    try {
      await resumeExecution(exec.id);
      processed++;
    } catch (err: any) {
      console.error(`[FollowUp] Error resuming execution ${exec.id}:`, err.message);
      errors++;

      // Mark as error if it fails
      await supabase
        .from("flow_executions")
        .update({ status: "error" })
        .eq("id", exec.id);
    }
  }

  console.log(`[FollowUp] Processed ${processed} follow-ups, ${errors} errors`);
  return { processed, errors };
}
