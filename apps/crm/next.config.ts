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
  // Next.js 15: serverActions e estavel, sai de experimental.
  // 20MB alinha com: bucket 'tools' (20971520 bytes), limite do
  // WhatsApp pra video/audio (16MB) + folga, e imagens PNG/PDF.
  serverActions: {
    bodySizeLimit: "20mb",
  },
  experimental: {},
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://tqogqaqwqbdfoevuizxu.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxb2dxYXF3cWJkZm9ldnVpenh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjcwNDksImV4cCI6MjA5MDUwMzA0OX0.K9XL7P11raeB69MKHHW9yAdhkoTAlqRaxu_3zojmZT4",
    NEXT_PUBLIC_APP_URL: "https://crm.funilpersia.top",
  },
};

export default nextConfig;
