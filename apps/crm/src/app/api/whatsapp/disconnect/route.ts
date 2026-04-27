import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProvider } from "@/lib/whatsapp/providers";

export async function POST() {
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

    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("*")
      .eq("organization_id", member.organization_id)
      .single();

    if (!connection) {
      return NextResponse.json({ error: "Nenhuma conexao" }, { status: 404 });
    }

    const provider = createProvider(connection);
    await provider.logout().catch(() => {});

    await supabase
      .from("whatsapp_connections")
      .update({ status: "disconnected", updated_at: new Date().toISOString() })
      .eq("id", connection.id);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
