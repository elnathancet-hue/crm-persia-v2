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

  // Find executions that are waiting and due to resume
  const { data: executions, error } = await supabase
    .from("flow_executions")
    .select("id, data")
    .eq("status", "waiting")
    .order("started_at", { ascending: true })
    .limit(50); // Process max 50 at a time

  if (error || !executions) {
    console.error("[FollowUp] Error fetching executions:", error?.message);
    return { processed: 0, errors: 1 };
  }

  // Filter to only those whose resume_at has passed
  const dueExecutions = executions.filter((exec) => {
    const resumeAt = exec.data?.resume_at;
    if (!resumeAt) return false;
    return new Date(resumeAt) <= new Date(now);
  });

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
