import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProvider } from "@/lib/whatsapp/providers";

export async function GET() {
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

    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("*")
      .eq("organization_id", member.organization_id)
      .single();

    if (!connection) {
      return NextResponse.json({ connected: false, status: "not_configured" });
    }

    try {
      const provider = createProvider(connection);
      const status = await provider.getStatus();

      const newStatus = status.connected && status.loggedIn ? "connected" : "disconnected";
      if (newStatus !== connection.status) {
        await supabase
          .from("whatsapp_connections")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", connection.id);
      }

      return NextResponse.json({
        connected: status.connected && status.loggedIn,
        status: newStatus,
        phoneNumber: connection.phone_number || null,
      });
    } catch {
      return NextResponse.json({ connected: false, status: "unreachable" });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
