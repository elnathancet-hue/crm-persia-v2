#!/usr/bin/env node
/**
 * Postbuild — copia assets estáticos pra dentro do bundle standalone.
 *
 * Por que: `output: "standalone"` no next.config gera `.next/standalone/`
 * com o subset minimo de arquivos pra subir o servidor (server.js +
 * deps node_modules), mas NAO inclui `public/` nem `.next/static/`.
 * O server.js, ao subir, espera achar esses dois ao lado dele:
 *   - `./public/` (servido em /<arquivo>)
 *   - `./.next/static/` (servido em /_next/static/<arquivo>)
 *
 * Sem este copy, o servidor sobe ok mas a UI fica sem fontes, imagens,
 * CSS e chunks JS — quebra completa do frontend.
 *
 * Como: este script roda apos `next build` (postbuild hook do
 * package.json) e copia os dois diretorios.
 *
 * Estrutura final:
 *   apps/admin/.next/standalone/
 *   ├── apps/admin/
 *   │   ├── server.js            (gerado pelo Next)
 *   │   ├── public/              (copiado por este script)
 *   │   └── .next/static/        (copiado por este script)
 *   └── node_modules/            (gerado pelo Next)
 *
 * Path do standalone: como `outputFileTracingRoot` aponta pra raiz do
 * monorepo, o Next replica a estrutura "apps/admin/" dentro do
 * standalone — server.js fica em `.next/standalone/apps/admin/server.js`.
 */

import { cp, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ROOT = path.resolve(__dirname, "..");
const STANDALONE_APP_DIR = path.join(
  APP_ROOT,
  ".next",
  "standalone",
  "apps",
  "admin",
);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, destSubpath, label) {
  const dest = path.join(STANDALONE_APP_DIR, destSubpath);
  if (!(await exists(src))) {
    console.warn(`[copy-standalone-assets] ⚠ skip ${label}: ${src} não existe`);
    return;
  }
  await cp(src, dest, { recursive: true });
  console.log(`[copy-standalone-assets] ✓ ${label}: ${src} → ${dest}`);
}

async function main() {
  if (!(await exists(STANDALONE_APP_DIR))) {
    console.error(
      `[copy-standalone-assets] ✗ standalone dir não encontrado em ${STANDALONE_APP_DIR}\n` +
        `   Verifique se 'next build' rodou com 'output: \"standalone\"' no next.config.ts.`,
    );
    process.exit(1);
  }

  await copyDir(path.join(APP_ROOT, "public"), "public", "public/");
  await copyDir(
    path.join(APP_ROOT, ".next", "static"),
    path.join(".next", "static"),
    ".next/static/",
  );
}

main().catch((err) => {
  console.error("[copy-standalone-assets] ✗ erro:", err);
  process.exit(1);
});
