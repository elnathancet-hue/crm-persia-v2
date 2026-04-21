import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://tqogqaqwqbdfoevuizxu.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxb2dxYXF3cWJkZm9ldnVpenh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjcwNDksImV4cCI6MjA5MDUwMzA0OX0.K9XL7P11raeB69MKHHW9yAdhkoTAlqRaxu_3zojmZT4",
    NEXT_PUBLIC_APP_URL: "https://crm.funilpersia.top",
  },
};

export default nextConfig;
