import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import persiaPlugin from "@persia/eslint-plugin";

// Sprint 6 (PR arch — lint rules CI): regras custom que automatizam
// o checklist da arquitetura em camadas. Cada regra mapeia pra um
// pattern do design system e impede regressão dos bugs catalogados
// em memory/project_prod_bugs_pending_post_wave4.md.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      "@persia": persiaPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",

      // === Sprint 6 — Patterns da arquitetura em camadas ===
      // Pattern #2 (React #418): proíbe Date.now()/toLocaleX/formatDistanceToNow
      // direto em JSX. Forçar <RelativeTime /> do @persia/ui.
      "@persia/no-bare-date-in-jsx": "error",
      // a11y: <Input>/<Textarea> sem name= quebram autofill e screen reader.
      "@persia/named-input": "error",
      // a11y: <Button> icon-only sem aria-label deixa screen reader mudo.
      "@persia/icon-only-needs-aria-label": "error",
    },
  },
  // === Sprint 6 — overrides pra telas FORA do escopo /crm migrado ===
  // Estas telas ainda têm dívida pré-existente dos patterns. Manter como
  // `warn` deixa o sinal visível no CI sem quebrar build. Quando migrarmos
  // cada uma pro pattern, basta remover do glob abaixo.
  //
  // Roadmap futuro de migração (não-obrigatório):
  //   - settings/* (queues, webhooks, billing, team, whatsapp)
  //   - components/ai/*  (AI Agent)
  //   - components/campaigns/*
  //   - components/chat/*  (Chat)
  //   - components/onboarding/*  (Setup wizard)
  {
    files: [
      // (dashboard)/* — features fora do menu CRM core
      "src/app/(dashboard)/admin/**",
      "src/app/(dashboard)/ai/**",
      "src/app/(dashboard)/automations/**",
      "src/app/(dashboard)/email/**",
      "src/app/(dashboard)/flows/**",
      "src/app/(dashboard)/groups/**",
      "src/app/(dashboard)/landing-pages/**",
      "src/app/(dashboard)/leads/fields/**", // custom fields manager (config)
      "src/app/(dashboard)/settings/**",
      // components/* — features fora do menu CRM core
      "src/components/ai/**",
      "src/components/campaigns/**",
      "src/components/chat/**",
      "src/components/onboarding/**",
    ],
    rules: {
      "@persia/no-bare-date-in-jsx": "warn",
      "@persia/named-input": "warn",
      "@persia/icon-only-needs-aria-label": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
