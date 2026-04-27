import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // `output: "standalone"` empacota o admin pra rodar isolado, copiando
  // o subset minimo de node_modules e os workspace packages
  // (@persia/shared, @persia/ai-agent-ui, @persia/ui) — essencial pra
  // monorepo pnpm, onde os symlinks de workspace nao sobrevivem fora
  // do contexto do install.
  //
  // IMPORTANTE: como ja tem standalone, NAO usar `next start` no script
  // de start (Next 15 e incompativel — emite warning + termina o
  // processo logo apos "Ready", o que o EasyPanel interpreta como crash
  // e manda SIGTERM em loop). Usar `node .next/standalone/apps/admin/
  // server.js` (ver apps/admin/package.json e DEPLOY.md).
  //
  // O server.js gerado pelo standalone NAO inclui assets estaticos
  // (`public/` e `.next/static/`) — esses sao copiados manualmente pelo
  // postbuild em `scripts/copy-standalone-assets.mjs`. Sem isso o
  // servidor sobe mas a UI fica sem fontes/imagens/CSS.
  output: "standalone",
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
