import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.email || !body.password) {
      return NextResponse.json({ error: "Email e senha obrigatorios" }, { status: 400 });
    }

    // Create response first - cookies will be set on it
    const response = NextResponse.json({ ok: true });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error) {
      console.error("[LOGIN] Auth error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    const admin = getAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("is_superadmin")
      .eq("id", data.user.id)
      .single<{ is_superadmin: boolean }>();

    if (!profile?.is_superadmin) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "Acesso restrito ao painel administrativo" },
        { status: 403 }
      );
    }

    // Return response with auth cookies set
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    console.error("[LOGIN] Crash:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
