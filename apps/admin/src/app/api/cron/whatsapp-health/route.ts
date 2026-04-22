import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/supabase-admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { createUazapiClient } from "@/lib/whatsapp/uazapi";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isInvalidTokenError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("401") || msg.includes("invalid token") || msg.includes("missing token");
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uazapiAdminToken = process.env.UAZAPI_ADMIN_TOKEN;
  return withAdmin("cron_whatsapp_health", async (admin) => {

  const { data: connections, error } = await admin
    .from("whatsapp_connections")
    .select("id, organization_id, provider, instance_url, instance_token, status")
    .eq("status", "connected")
    .not("instance_url", "is", null)
    .not("instance_token", "is", null)
    .limit(500);

  if (error) {
    console.error("[WhatsApp Health] Failed to fetch connections:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { checked: 0, ok: 0, disconnected: 0, recreated: 0, errors: 0 };

  await Promise.allSettled(
    (connections || []).map(async (conn) => {
      results.checked++;
      try {
        const provider = createProvider(conn);
        const status = await provider.getStatus();

        if (!status.connected) {
          await admin
            .from("whatsapp_connections")
            .update({ status: "disconnected", updated_at: new Date().toISOString() })
            .eq("id", conn.id);
          results.disconnected++;
          console.warn(`[WhatsApp Health] org=${conn.organization_id} marked disconnected`);
        } else {
          results.ok++;
        }
      } catch (e) {
        // Instance missing from UAZAPI (server restarted) — recreate automatically
        if (isInvalidTokenError(e) && uazapiAdminToken) {
          try {
            const uazapi = createUazapiClient(conn.instance_url!, conn.instance_token!, uazapiAdminToken);

            const created = await uazapi.createInstance(conn.organization_id);
            const raw = created as unknown as Record<string, unknown>;
            const newToken =
              (raw.instance as Record<string, unknown> | undefined)?.token as string | undefined
              ?? raw.token as string | undefined;

            if (newToken) {
              await admin
                .from("whatsapp_connections")
                .update({
                  instance_token: newToken,
                  status: "disconnected",
                  phone_number: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", conn.id);

              results.recreated++;
              console.warn(
                `[WhatsApp Health] org=${conn.organization_id} instance recreated — needs QR scan`
              );
            } else {
              throw new Error("createInstance returned no token");
            }
          } catch (recreateErr) {
            results.errors++;
            console.error(
              `[WhatsApp Health] org=${conn.organization_id} recreate failed:`,
              recreateErr instanceof Error ? recreateErr.message : String(recreateErr)
            );
          }
        } else {
          // Transient error (timeout, 5xx) — do not mark disconnected
          results.errors++;
          console.error(
            `[WhatsApp Health] org=${conn.organization_id} check failed:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    })
  );

    return NextResponse.json({ ...results, timestamp: new Date().toISOString() });
  });
}
