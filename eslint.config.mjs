// Root ESLint config — lints packages/* shared UI surfaces.
//
// Apps (apps/crm + apps/admin) tem cada um seu proprio eslint.config.mjs
// usando eslint-config-next. Este config aqui foca em packages/*/src/**
// onde o eslint-config-next nao alcanca (defaults Next limitam ao
// projeto root). Foco: regras do design system criadas em
// @persia/eslint-plugin.
//
// PR 10/10 — Fase 2 (mai/2026): estender no-hardcoded-tailwind-color
// pros packages (antes so apps/crm/ era linted) E flipar pra "error"
// como gate definitivo. Apenas paletas intencionais (4 lugares
// documentados inline) e comentarios mantem cores cromaticas — todo
// novo callsite de cor passa pelos tokens semanticos.

import { defineConfig } from "eslint/config";
import persiaPlugin from "@persia/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const eslintConfig = defineConfig([
  {
    files: ["packages/**/src/**/*.{ts,tsx}"],
    linterOptions: {
      // Inline `eslint-disable-next-line` apontam pra regras configuradas
      // no apps/crm/eslint.config.mjs (react-hooks/* / @typescript-eslint/*)
      // — desligamos a deteccao de "rule not found" pra esses comentarios.
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    // O root config so se importa com a regra do DS. Outras (a11y, hooks)
    // ficam pro lint dos apps que ja tem eslint-config-next.
    //
    // Plugins referenciados inline em packages/* (react-hooks/*,
    // @typescript-eslint/*) precisam ser conhecidos pelo eslint mesmo
    // se nao habilitados — stub minimo evita "rule not found".
    plugins: {
      "@persia": persiaPlugin,
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
          "rules-of-hooks": { create: () => ({}) },
          "set-state-in-effect": { create: () => ({}) },
          "preserve-manual-memoization": { create: () => ({}) },
        },
      },
      "@typescript-eslint": {
        rules: {
          "no-unused-vars": { create: () => ({}) },
          "no-explicit-any": { create: () => ({}) },
        },
      },
    },
    rules: {
      // PR-DSBASE / PR-ANTIBUG / PR 10/10:
      // Bloqueia cor cromatica hardcoded em className. Tokens semanticos
      // (success/failure/progress/warning/primary/destructive/muted)
      // resolvem light/dark automaticamente. Veja apps/crm/src/app/
      // globals.css pra ver os tokens disponiveis.
      "@persia/no-hardcoded-tailwind-color": "error",
    },
  },
  {
    // Paletas intencionais (avatars hash-based) usam cromaticas legais.
    // Documentadas inline em cada um desses arquivos.
    files: [
      "packages/crm-ui/src/components/KanbanBoard.tsx",
      "packages/leads-ui/src/components/LeadsList.tsx",
      "packages/leads-ui/src/components/LeadCommentsTab.tsx",
    ],
    rules: {
      "@persia/no-hardcoded-tailwind-color": "off",
    },
  },
  {
    // Comentarios documentando o que era antes (typography, LeadInfoDrawer)
    // disparam falso positivo no regex. Suprimir nestes 2 arquivos.
    files: [
      "packages/ui/src/components/typography.tsx",
      "packages/leads-ui/src/components/LeadInfoDrawer.tsx",
      "packages/agenda-ui/src/lib/agenda-tones.ts",
    ],
    rules: {
      "@persia/no-hardcoded-tailwind-color": "off",
    },
  },
]);

export default eslintConfig;
