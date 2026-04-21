import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeCampaign } from "@/lib/whatsapp/send-campaign";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

    const { data: member } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (!member) return NextResponse.json({ error: "Sem organizacao" }, { status: 403 });

    const { campaignId } = await request.json();
    if (!campaignId) return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 });

    // Get campaign details
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("organization_id", member.organization_id)
      .single();

    if (!campaign) return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 });

    // Execute in background (non-blocking)
    const result = await executeCampaign({
      campaignId: campaign.id,
      orgId: member.organization_id,
      message: campaign.message ?? "",
      targetTags: campaign.target_tags || [],
      intervalMs: 3000, // 3 seconds between sends (safe default)
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
