import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  transpilePackages: [
    "@persia/shared",
    "@persia/ui",
    "@persia/crm-ui",
    "@persia/leads-ui",
    "@persia/ai-agent-ui",
    "@persia/tags-ui",
    "@persia/segments-ui",
    "@persia/agenda-ui",
  ],
  experimental: {
    // Fix mai/2026 — Biblioteca de midia (/automations/tools) usa
    // Server Action com FormData pra subir arquivos pro Supabase
    // Storage. Default do Next 15 e 1MB por Server Action body —
    // qualquer arquivo maior dava "Server Components render error"
    // generico em prod (cliente nao conseguia subir PNG/PDF).
    //
    // 20MB alinha com:
    //   - file_size_limit do bucket 'tools' (20971520 bytes)
    //   - limite do WhatsApp Business pra video/audio (16MB) + folga
    //   - imagem padrao do WhatsApp (5MB) com sobra grande
    //
    // Mexer em qualquer dos 3 (Next, bucket, WhatsApp) sem alinhar
    // os outros volta a quebrar uploads de tamanho intermediario.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://tqogqaqwqbdfoevuizxu.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxb2dxYXF3cWJkZm9ldnVpenh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjcwNDksImV4cCI6MjA5MDUwMzA0OX0.K9XL7P11raeB69MKHHW9yAdhkoTAlqRaxu_3zojmZT4",
    NEXT_PUBLIC_APP_URL: "https://crm.funilpersia.top",
  },
};

export default nextConfig;
