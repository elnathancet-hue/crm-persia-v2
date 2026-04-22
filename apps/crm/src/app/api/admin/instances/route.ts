import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UAZAPI_BASE = process.env.UAZAPI_BASE_URL || "https://persia.uazapi.com";
const ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN || "";
const LEGACY_ROUTE_ENABLED = process.env.ENABLE_LEGACY_UAZAPI_ADMIN_ROUTES === "true";

function legacyRouteDisabled() {
  console.warn(
    "[UAZAPI Admin Instances] Legacy global admin route blocked. " +
      "Set ENABLE_LEGACY_UAZAPI_ADMIN_ROUTES=true only for temporary rollback."
  );
  return NextResponse.json({ error: "Endpoint disabled" }, { status: 404 });
}

async function requireAdmin(request?: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("is_active", true)
    .single();

  if (!member) throw new Error("Acesso negado");
  return user;
}

// GET - List all instances
export async function GET() {
  if (!LEGACY_ROUTE_ENABLED) return legacyRouteDisabled();

  try {
    await requireAdmin();

    const res = await fetch(`${UAZAPI_BASE}/instance/all`, {
      headers: { admintoken: ADMIN_TOKEN },
    });
    const instances = await res.json();

    return NextResponse.json(instances);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
}

// POST - Create instance + connect (returns QR code)
export async function POST(request: NextRequest) {
  if (!LEGACY_ROUTE_ENABLED) return legacyRouteDisabled();

  try {
    await requireAdmin();
    const { name, action, token: instanceToken } = await request.json();

    if (action === "connect" && instanceToken) {
      // Connect existing instance - get QR code
      const res = await fetch(`${UAZAPI_BASE}/instance/connect`, {
        method: "POST",
        headers: {
          token: instanceToken,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();

      // Set webhook and fields map automatically when connected
      if (data.status?.connected && data.status?.loggedIn) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.funilpersia.top";
        await fetch(`${UAZAPI_BASE}/webhook`, {
          method: "POST",
          headers: {
            token: instanceToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enabled: true,
            url: `${appUrl}/api/whatsapp/webhook`,
            events: ["messages", "connection"],
          }),
        });

        // Setup default CRM fields map (fire and forget)
        import("@/lib/whatsapp/sync").then(({ setupFieldsMap }) => {
          setupFieldsMap(UAZAPI_BASE, instanceToken);
        }).catch((err) => {
          console.error("[Instances] setupFieldsMap error:", err);
        });
      }

      return NextResponse.json({
        qrCode: data.qrcode || data.instance?.qrcode || null,
        status: data.status?.connected ? "connected" : "qr",
        instance: data.instance || data,
      });
    }

    if (action === "disconnect" && instanceToken) {
      await fetch(`${UAZAPI_BASE}/instance/disconnect`, {
        method: "POST",
        headers: { token: instanceToken },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete" && instanceToken) {
      await fetch(`${UAZAPI_BASE}/instance`, {
        method: "DELETE",
        headers: { token: instanceToken },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "status" && instanceToken) {
      const res = await fetch(`${UAZAPI_BASE}/instance/status`, {
        headers: { token: instanceToken },
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "webhook" && instanceToken) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.funilpersia.top";
      await fetch(`${UAZAPI_BASE}/webhook`, {
        method: "POST",
        headers: {
          token: instanceToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          url: `${appUrl}/api/whatsapp/webhook`,
          events: ["messages", "connection"],
        }),
      });
      return NextResponse.json({ ok: true, webhookUrl: `${appUrl}/api/whatsapp/webhook` });
    }

    // Create new instance
    if (!name) return NextResponse.json({ error: "Nome obrigatorio" }, { status: 400 });

    const res = await fetch(`${UAZAPI_BASE}/instance/create`, {
      method: "POST",
      headers: {
        admintoken: ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();

    // Auto-connect to get QR code
    if (data.token) {
      const connectRes = await fetch(`${UAZAPI_BASE}/instance/connect`, {
        method: "POST",
        headers: {
          token: data.token,
          "Content-Type": "application/json",
        },
      });
      const connectData = await connectRes.json();

      return NextResponse.json({
        instance: data.instance || data,
        token: data.token,
        qrCode: connectData.qrcode || connectData.instance?.qrcode || null,
        status: "qr",
      });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
