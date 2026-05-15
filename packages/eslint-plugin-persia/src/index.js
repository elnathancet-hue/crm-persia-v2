// @persia/eslint-plugin
//
// Regras custom que automatizam o checklist da arquitetura em camadas
// (Sprint 0 — memory/project_architecture_layers.md). Cada regra mapeia
// pra um pattern do design system (packages/ui/docs/patterns.md) e
// impede regressão dos bugs que motivaram a refatoração.
//
// Ver Sprint 6 (PR atual). Roda no CI via apps/crm/eslint.config.mjs.

import noBareDateInJsx from "./rules/no-bare-date-in-jsx.js";
import namedInput from "./rules/named-input.js";
import iconOnlyNeedsAriaLabel from "./rules/icon-only-needs-aria-label.js";
import noHardcodedTailwindColor from "./rules/no-hardcoded-tailwind-color.js";
import noStyleOverrideOnPrimitive from "./rules/no-style-override-on-primitive.js";

const plugin = {
  meta: {
    name: "@persia/eslint-plugin",
    version: "0.1.0",
  },
  rules: {
    "no-bare-date-in-jsx": noBareDateInJsx,
    "named-input": namedInput,
    "icon-only-needs-aria-label": iconOnlyNeedsAriaLabel,
    "no-hardcoded-tailwind-color": noHardcodedTailwindColor,
    "no-style-override-on-primitive": noStyleOverrideOnPrimitive,
  },
};

export default plugin;
