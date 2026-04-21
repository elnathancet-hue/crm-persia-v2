import { createClient } from "@supabase/supabase-js";
import { createProvider } from "@/lib/whatsapp/providers";

// Service-role client for background processing (bypasses RLS)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============ TYPES ============

export interface FlowNode {
  id: string;
  type: string;
  data: Record<string, any>;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // "default", "true", "false"
}

export interface FlowExecution {
  id: string;
  organization_id: string;
  flow_id: string;
  lead_id: string;
  current_node_id: string | null;
  status: "running" | "waiting" | "completed" | "error";
  started_at: string;
  completed_at: string | null;
  data: Record<string, any>;
}

interface Lead {
  id: string;
  organization_id: string;
  phone: string;
  name: string;
  email: string | null;
  status: string;
  score: number | null;
  tags: string[] | null;
  channel: string | null;
  source: string | null;
}

// ============ PLACEHOLDER REPLACEMENT ============

function replacePlaceholders(text: string, lead: Lead): string {
  return text
    .replace(/\{nome\}/gi, lead.name || "")
    .replace(/\{telefone\}/gi, lead.phone || "")
    .replace(/\{email\}/gi, lead.email || "")
    .replace(/\{status\}/gi, lead.status || "")
    .replace(/\{canal\}/gi, lead.channel || "")
    .replace(/\{fonte\}/gi, lead.source || "");
}

// ============ FLOW ENGINE ============

/**
 * Execute a flow for a given lead. Creates an execution record and processes nodes sequentially.
 */
export async function executeFlow(
  flowId: string,
  leadId: string,
  orgId: string,
  triggerData?: Record<string, any>
): Promise<string | null> {
  const supabase = getSupabase();

  try {
    // 1. Load the flow
    const { data: flow, error: flowError } = await supabase
      .from("flows")
      .select("*")
      .eq("id", flowId)
      .single();

    if (flowError || !flow) {
      console.error(`[FlowEngine] Flow not found: ${flowId}`);
      return null;
    }

    const nodes: FlowNode[] = flow.nodes || [];
    const edges: FlowEdge[] = flow.edges || [];

    if (nodes.length === 0) {
      console.error(`[FlowEngine] Flow has no nodes: ${flowId}`);
      return null;
    }

    // 2. Load the lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      console.error(`[FlowEngine] Lead not found: ${leadId}`);
      return null;
    }

    // 3. Find trigger node (first node with no incoming edges)
    const targetNodeIds = new Set(edges.map((e) => e.target));
    const triggerNode = nodes.find((n) => !targetNodeIds.has(n.id));

    if (!triggerNode) {
      console.error(`[FlowEngine] No trigger node found in flow: ${flowId}`);
      return null;
    }

    // 4. Create flow execution record
    const { data: execution, error: execError } = await supabase
      .from("flow_executions")
      .insert({
        organization_id: orgId,
        flow_id: flowId,
        lead_id: leadId,
        current_node_id: triggerNode.id,
        status: "running",
        started_at: new Date().toISOString(),
        data: { trigger_data: triggerData || {} },
      })
      .select()
      .single();

    if (execError || !execution) {
      console.error(`[FlowEngine] Failed to create execution:`, execError?.message);
      return null;
    }

    // 5. Execute nodes starting from the trigger's first outgoing edge
    await executeFromNode(execution.id, triggerNode.id, nodes, edges, lead, orgId);

    return execution.id;
  } catch (err: any) {
    console.error(`[FlowEngine] executeFlow error:`, err.message);
    return null;
  }
}

/**
 * Resume a paused flow execution from a specific node.
 */
export async function resumeExecution(executionId: string): Promise<void> {
  const supabase = getSupabase();

  try {
    const { data: execution, error } = await supabase
      .from("flow_executions")
      .select("*")
      .eq("id", executionId)
      .single();

    if (error || !execution) {
      console.error(`[FlowEngine] Execution not found: ${executionId}`);
      return;
    }

    if (execution.status !== "waiting") {
      console.error(`[FlowEngine] Execution ${executionId} is not waiting, status: ${execution.status}`);
      return;
    }

    // Load lead
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", execution.lead_id)
      .single();

    if (!lead) {
      console.error(`[FlowEngine] Lead not found for execution: ${executionId}`);
      return;
    }

    // Load flow
    const { data: flow } = await supabase
      .from("flows")
      .select("nodes, edges")
      .eq("id", execution.flow_id)
      .single();

    if (!flow) {
      console.error(`[FlowEngine] Flow not found for execution: ${executionId}`);
      return;
    }

    const nodes: FlowNode[] = flow.nodes || [];
    const edges: FlowEdge[] = flow.edges || [];

    // Mark as running again
    await supabase
      .from("flow_executions")
      .update({ status: "running" })
      .eq("id", executionId);

    // Continue from the NEXT node after the wait node
    const currentNodeId = execution.current_node_id;
    const outgoingEdge = edges.find(
      (e) => e.source === currentNodeId && (e.sourceHandle === "default" || !e.sourceHandle)
    );

    if (!outgoingEdge) {
      // No next node - flow is complete
      await supabase
        .from("flow_executions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", executionId);
      return;
    }

    await executeFromNode(executionId, outgoingEdge.target, nodes, edges, lead, execution.organization_id);
  } catch (err: any) {
    console.error(`[FlowEngine] resumeExecution error:`, err.message);
  }
}

/**
 * Execute the flow starting from a given nodeId, following edges.
 */
async function executeFromNode(
  executionId: string,
  startNodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  lead: Lead,
  orgId: string
): Promise<void> {
  const supabase = getSupabase();
  let currentNodeId: string | null = startNodeId;

  while (currentNodeId) {
    const node = nodes.find((n) => n.id === currentNodeId);
    if (!node) {
      console.error(`[FlowEngine] Node not found: ${currentNodeId}`);
      break;
    }

    // Update current_node_id
    await supabase
      .from("flow_executions")
      .update({ current_node_id: currentNodeId })
      .eq("id", executionId);

    try {
      const result = await executeNode(node, lead, orgId, executionId);

      if (result.action === "wait") {
        // Pause execution - save resume time
        await supabase
          .from("flow_executions")
          .update({
            status: "waiting",
            current_node_id: currentNodeId,
            data: {
              resume_at: result.resumeAt,
            },
          })
          .eq("id", executionId);
        return; // Exit loop - will be resumed later
      }

      if (result.action === "stop") {
        break;
      }

      // Find next node via edge
      const handleToFollow = result.handle || "default";
      const outgoingEdge = edges.find(
        (e) =>
          e.source === currentNodeId &&
          (e.sourceHandle === handleToFollow || (!e.sourceHandle && handleToFollow === "default"))
      );

      if (outgoingEdge) {
        currentNodeId = outgoingEdge.target;
      } else {
        currentNodeId = null; // No more edges - end
      }
    } catch (err: any) {
      console.error(`[FlowEngine] Error executing node ${currentNodeId}:`, err.message);

      // Log error but try to continue to next default edge
      const outgoingEdge = edges.find(
        (e) => e.source === currentNodeId && (e.sourceHandle === "default" || !e.sourceHandle)
      );

      if (outgoingEdge) {
        currentNodeId = outgoingEdge.target;
      } else {
        currentNodeId = null;
      }
    }
  }

  // Flow completed
  await supabase
    .from("flow_executions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", executionId);
}

// ============ NODE EXECUTORS ============

interface NodeResult {
  action: "continue" | "wait" | "stop";
  handle?: string; // "default", "true", "false"
  resumeAt?: string; // ISO date for wait nodes
}

async function executeNode(
  node: FlowNode,
  lead: Lead,
  orgId: string,
  executionId: string
): Promise<NodeResult> {
  switch (node.type) {
    // -- TRIGGERS (just pass through) --
    case "new_lead":
    case "keyword":
    case "tag_added":
    case "stage_changed":
      return { action: "continue", handle: "default" };

    // -- ACTIONS --
    case "send_message":
      return executeSendMessage(node, lead, orgId);

    case "wait":
      return executeWait(node);

    case "add_tag":
      return executeAddTag(node, lead, orgId);

    case "assign_agent":
      return executeAssignAgent(node, lead, orgId);

    case "move_stage":
      return executeMoveStage(node, lead, orgId);

    case "activate_ai":
      return executeActivateAi(node, lead, orgId);

    case "send_webhook":
      return executeSendWebhook(node, lead, orgId);

    // -- CONDITIONS --
    case "check_tag":
      return executeCheckTag(node, lead, orgId);

    case "check_field":
      return executeCheckField(node, lead);

    default:
      console.warn(`[FlowEngine] Unknown node type: ${node.type}`);
      return { action: "continue", handle: "default" };
  }
}

// --- send_message ---
async function executeSendMessage(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();
  const message = replacePlaceholders(node.data.message || "", lead);

  if (!message || !lead.phone) {
    return { action: "continue", handle: "default" };
  }

  // Get WhatsApp connection for this org
  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) {
    console.error(`[FlowEngine] No WhatsApp connection for org: ${orgId}`);
    return { action: "continue", handle: "default" };
  }

  const provider = createProvider(connection);

  // Send typing indicator
  await provider.setTyping(lead.phone, true).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Send the message
  await provider.sendText({ phone: lead.phone, message });

  // Save message to DB
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (conversation) {
    await supabase.from("messages").insert({
      organization_id: orgId,
      conversation_id: conversation.id,
      lead_id: lead.id,
      content: message,
      sender: "flow",
      type: "text",
    });
  }

  return { action: "continue", handle: "default" };
}

// --- wait ---
function executeWait(node: FlowNode): NodeResult {
  const amount = node.data.amount || 1;
  const unit = node.data.unit || "minutes"; // "minutes", "hours", "days"

  let ms: number;
  switch (unit) {
    case "hours":
      ms = amount * 60 * 60 * 1000;
      break;
    case "days":
      ms = amount * 24 * 60 * 60 * 1000;
      break;
    default: // minutes
      ms = amount * 60 * 1000;
      break;
  }

  const resumeAt = new Date(Date.now() + ms).toISOString();

  return { action: "wait", resumeAt };
}

// --- add_tag ---
async function executeAddTag(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();
  const tagName = node.data.tag_name || node.data.tag;

  if (!tagName) return { action: "continue", handle: "default" };

  // Find or create the tag
  let { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", tagName)
    .single();

  if (!tag) {
    const { data: newTag } = await supabase
      .from("tags")
      .insert({ organization_id: orgId, name: tagName, color: "#6366f1" })
      .select("id")
      .single();
    tag = newTag;
  }

  if (tag) {
    // Check if already tagged
    const { data: existing } = await supabase
      .from("lead_tags")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("tag_id", tag.id)
      .single();

    if (!existing) {
      await supabase.from("lead_tags").insert({
        lead_id: lead.id,
        tag_id: tag.id,
        organization_id: lead.organization_id,
      });
    }
  }

  // Also update the tags array on the lead (denormalized)
  const currentTags = lead.tags || [];
  if (!currentTags.includes(tagName)) {
    await supabase
      .from("leads")
      .update({ tags: [...currentTags, tagName] })
      .eq("id", lead.id);
  }

  return { action: "continue", handle: "default" };
}

// --- assign_agent ---
async function executeAssignAgent(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();
  const assignTo = node.data.assign_to || "ai"; // "ai" or user_id

  await supabase
    .from("conversations")
    .update({ assigned_to: assignTo })
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"]);

  return { action: "continue", handle: "default" };
}

// --- move_stage ---
async function executeMoveStage(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();
  const stageId = node.data.stage_id;

  if (!stageId) return { action: "continue", handle: "default" };

  // Find deals for this lead and move them
  const { data: deals } = await supabase
    .from("deals")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .eq("status", "open");

  if (deals && deals.length > 0) {
    for (const deal of deals) {
      await supabase
        .from("deals")
        .update({ stage_id: stageId })
        .eq("id", deal.id);
    }
  }

  return { action: "continue", handle: "default" };
}

// --- activate_ai ---
async function executeActivateAi(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();

  // Set conversation to be handled by AI
  await supabase
    .from("conversations")
    .update({ assigned_to: "ai", status: "active" })
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"]);

  return { action: "continue", handle: "default" };
}

// --- send_webhook ---
async function executeSendWebhook(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const url = node.data.url;
  if (!url) return { action: "continue", handle: "default" };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "flow_webhook",
        organization_id: orgId,
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          status: lead.status,
          tags: lead.tags,
        },
        node_data: node.data,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err: any) {
    console.error(`[FlowEngine] Webhook failed for ${url}:`, err.message);
  }

  return { action: "continue", handle: "default" };
}

// --- check_tag (condition) ---
async function executeCheckTag(
  node: FlowNode,
  lead: Lead,
  orgId: string
): Promise<NodeResult> {
  const supabase = getSupabase();
  const tagName = node.data.tag_name || node.data.tag;

  if (!tagName) return { action: "continue", handle: "false" };

  // Check denormalized tags array first
  if (lead.tags && lead.tags.includes(tagName)) {
    return { action: "continue", handle: "true" };
  }

  // Fallback: check lead_tags table
  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", tagName)
    .single();

  if (tag) {
    const { data: leadTag } = await supabase
      .from("lead_tags")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("tag_id", tag.id)
      .single();

    if (leadTag) {
      return { action: "continue", handle: "true" };
    }
  }

  return { action: "continue", handle: "false" };
}

// --- check_field (condition) ---
async function executeCheckField(
  node: FlowNode,
  lead: Lead
): Promise<NodeResult> {
  const field = node.data.field as keyof Lead; // "status", "channel", "source", etc.
  const operator = node.data.operator || "equals"; // "equals", "contains", "not_empty"
  const value = node.data.value;

  if (!field) return { action: "continue", handle: "false" };

  const leadValue = String(lead[field] || "");

  let matches = false;
  switch (operator) {
    case "equals":
      matches = leadValue.toLowerCase() === String(value || "").toLowerCase();
      break;
    case "not_equals":
      matches = leadValue.toLowerCase() !== String(value || "").toLowerCase();
      break;
    case "contains":
      matches = leadValue.toLowerCase().includes(String(value || "").toLowerCase());
      break;
    case "not_empty":
      matches = leadValue.length > 0;
      break;
    case "empty":
      matches = leadValue.length === 0;
      break;
    default:
      matches = leadValue === value;
  }

  return { action: "continue", handle: matches ? "true" : "false" };
}
