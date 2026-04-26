import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Nao usar `output: "standalone"` aqui. O EasyPanel inicia este servico
  // via `next start` (ver DEPLOY.md secao 3.1.A — "Comando de Inicio:
  // pnpm run start:admin"), e Next 15 e incompatible com a combinacao
  // standalone + next start: ele avisa "next start does not work with
  // output: standalone configuration" e termina o processo logo apos
  // "Ready", o que o EasyPanel interpreta como crash e manda SIGTERM em
  // restart loop.
  //
  // O `outputFileTracingRoot` apontando pra raiz do monorepo continua
  // sendo necessario pra que o tracing inclua workspace packages
  // (@persia/shared, @persia/ai-agent-ui, @persia/ui) — sem ele os
  // symlinks de pnpm workspace ficam orphans no build de prod.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
