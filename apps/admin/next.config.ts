import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: include workspace packages (ex: @persia/shared) no bundle
  // standalone. Sem isso, Next so coleta o node_modules da pasta do app e
  // perde symlinks pro packages/shared, quebrando o deploy.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
