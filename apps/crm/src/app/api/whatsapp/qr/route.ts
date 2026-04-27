import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProvider } from "@/lib/whatsapp/providers";

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
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: "Sem organizacao" }, { status: 403 });

    const body = await request.json();
    const { instanceUrl, instanceToken } = body;

    if (!instanceUrl || !instanceToken) {
      return NextResponse.json({ error: "URL e Token sao obrigatorios" }, { status: 400 });
    }

    const provider = createProvider({ provider: "uazapi", instance_url: instanceUrl, instance_token: instanceToken });
    const result = await provider.connect();

    if (result.status === "error") {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (result.status === "connected") {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      await provider.setWebhook(`${appUrl}/api/whatsapp/webhook`);

      await supabase.from("whatsapp_connections").upsert(
        {
          organization_id: member.organization_id,
          instance_url: instanceUrl,
          instance_token: instanceToken,
          phone_number: result.phone || "",
          status: "connected",
          provider: "uazapi",
        },
        { onConflict: "organization_id" }
      );

      return NextResponse.json({ status: "connected" });
    }

    // QR code - save pending connection
    await supabase.from("whatsapp_connections").upsert(
      {
        organization_id: member.organization_id,
        instance_url: instanceUrl,
        instance_token: instanceToken,
        phone_number: "",
        status: "pending",
        provider: "uazapi",
      },
      { onConflict: "organization_id" }
    );

    return NextResponse.json({ qrCode: result.qrCode, status: "qr" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
