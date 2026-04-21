import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Public API for n8n to fetch tools.
 *
 * GET /api/tools?orgId=xxx                    → list all active tools for org
 * GET /api/tools?orgId=xxx&slug=cardapio      → get specific tool by slug
 * GET /api/tools?orgId=xxx&id=uuid            → get specific tool by ID
 * GET /api/tools?orgId=xxx&category=documento  → filter by category
 *
 * n8n usage in HTTP Request node:
 *   GET https://crm.funilpersia.top/api/tools?orgId={{$json.orgId}}&slug=cardapio
 *   → returns { file_url, file_name, file_type, name }
 *   → use file_url in UAZAPI /send/media to send to lead
 */
export async function GET(request: NextRequest) {
  // Authenticate: require Bearer token matching CRM_API_SECRET
  const authHeader = request.headers.get("authorization");
  const apiSecret = process.env.CRM_API_SECRET;
  if (!apiSecret || authHeader !== `Bearer ${apiSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const slug = searchParams.get("slug");
  const id = searchParams.get("id");
  const category = searchParams.get("category");

  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Get specific tool by ID
  if (id) {
    const { data, error } = await supabase
      .from("automation_tools")
      .select("id, name, description, category, file_url, file_name, file_type, file_size, slug")
      .eq("id", id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    // Increment usage count
    await supabase
      .from("automation_tools")
      .update({ usage_count: (data as any).usage_count + 1 || 1 })
      .eq("id", id);

    return NextResponse.json(data);
  }

  // Get specific tool by slug
  if (slug) {
    const { data, error } = await supabase
      .from("automation_tools")
      .select("id, name, description, category, file_url, file_name, file_type, file_size, slug")
      .eq("slug", slug)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    // Increment usage count
    await supabase
      .from("automation_tools")
      .update({ usage_count: (data as any).usage_count + 1 || 1 })
      .eq("id", (data as any).id);

    return NextResponse.json(data);
  }

  // List tools
  let query = supabase
    .from("automation_tools")
    .select("id, name, description, category, file_url, file_name, file_type, file_size, slug")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tools: data || [] });
}
