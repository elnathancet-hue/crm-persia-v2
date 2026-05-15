/**
 * no-hardcoded-tailwind-color
 *
 * Detecta classes Tailwind com cor cromatica crua (`bg-emerald-500`,
 * `text-red-600`, `border-purple-300`, etc) usadas em JSX `className=`.
 * Forca migracao pra tokens semanticos do design system:
 *   - bg-success / text-success / border-success-ring     (bem_sucedido)
 *   - bg-failure / text-failure / border-failure-ring     (falha)
 *   - bg-progress / text-progress / border-progress-ring  (em_andamento)
 *   - bg-primary / text-primary / border-primary
 *   - bg-muted / text-muted-foreground / border-border
 *   - bg-destructive / text-destructive
 *
 * Por que: cada feature nova tinha hardcode de cor diferente. Sem isso,
 * dark mode quebra silenciosamente, tokens de outcome nao sao usados,
 * drift visual fica garantido. Ver memory/feedback_anti_bug.md.
 *
 * Severity: warning (transicional). Migrar pra error em ~3 meses depois
 * que o sweep estiver completo.
 *
 * Fix: substitua pelo token semantico equivalente. Em dúvida, leia
 * apps/crm/src/app/globals.css (secao Outcome semantic tokens).
 *
 * Whitelist:
 *   - cores neutras: white, black, transparent, current, inherit
 *   - tokens semanticos ja registrados: ver SEMANTIC_TOKEN_NAMES
 *   - chart colors (chart-1..5) — ja sao tokens
 */

// Cores cromaticas do Tailwind que disparam o aviso. Ordem importa
// (palavras mais especificas antes — "destructive" antes de "red").
const CHROMATIC_COLORS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

// Prefixos de utility que recebem cor: bg, text, border, ring, fill,
// stroke, from, via, to, outline, divide, accent, caret, decoration,
// placeholder, shadow.
const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "outline",
  "divide",
  "accent",
  "caret",
  "decoration",
  "placeholder",
  "shadow",
];

// Pattern: opcional `dark:` ou `hover:` etc + (prefix)-(color)-(shade).
// Ex: `bg-emerald-500`, `dark:text-red-300`, `hover:border-blue-200/50`.
// Nao captura `bg-success`, `text-muted-foreground`, etc (tokens semanticos).
const COLOR_REGEX = new RegExp(
  String.raw`(?:^|[\s])(?:[\w-]+:)*?(${COLOR_PREFIXES.join(
    "|",
  )})-(${CHROMATIC_COLORS.join("|")})-\d{2,3}(?:\/\d+)?`,
  "g",
);

// Hex curtinho ou longo direto em className/style — `bg-[#3b82f6]`,
// `text-[#fff]`, etc. Tambem flagamos.
const HEX_REGEX = /\[#[0-9a-fA-F]{3,8}\]/g;

function checkLiteral(rawValue, context, node) {
  if (typeof rawValue !== "string") return;
  // Reset regex state (g flag).
  COLOR_REGEX.lastIndex = 0;
  HEX_REGEX.lastIndex = 0;

  const colorMatch = COLOR_REGEX.exec(rawValue);
  if (colorMatch) {
    context.report({
      node,
      messageId: "noHardcodedTailwindColor",
      data: { match: colorMatch[0].trim() },
    });
    return;
  }
  const hexMatch = HEX_REGEX.exec(rawValue);
  if (hexMatch) {
    context.report({
      node,
      messageId: "noHardcodedTailwindColor",
      data: { match: hexMatch[0] },
    });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Proíbe cores cromáticas hardcoded em className (`bg-emerald-500`, `text-red-600`, `bg-[#3b82f6]`). Use tokens semânticos do DS (bg-success/failure/progress/primary/muted/destructive).",
      recommended: true,
    },
    schema: [],
    messages: {
      noHardcodedTailwindColor:
        "Cor hardcoded `{{match}}` — use token semântico do design system (bg-success/failure/progress/primary/muted/destructive). Ver apps/crm/src/app/globals.css.",
    },
  },
  create(context) {
    function checkAttr(attrNode) {
      if (
        !attrNode ||
        !attrNode.name ||
        (attrNode.name.name !== "className" && attrNode.name.name !== "class")
      ) {
        return;
      }
      const value = attrNode.value;
      if (!value) return;

      // className="literal aqui"
      if (value.type === "Literal") {
        checkLiteral(value.value, context, attrNode);
        return;
      }

      // className={...}
      if (value.type === "JSXExpressionContainer") {
        walkExpression(value.expression, context, attrNode);
      }
    }

    return {
      JSXAttribute: checkAttr,
    };
  },
};

function walkExpression(expr, context, jsxNode) {
  if (!expr) return;

  // String literal direta: className={"bg-emerald-500"}
  if (expr.type === "Literal" && typeof expr.value === "string") {
    checkLiteral(expr.value, context, jsxNode);
    return;
  }

  // Template string: `bg-${cond} text-emerald-600`
  if (expr.type === "TemplateLiteral") {
    for (const quasi of expr.quasis) {
      if (quasi.value && quasi.value.cooked) {
        checkLiteral(quasi.value.cooked, context, jsxNode);
      }
    }
    return;
  }

  // cn(...) / clsx(...) / cva(...) / tailwind-merge — entra em cada arg
  if (expr.type === "CallExpression") {
    for (const arg of expr.arguments) {
      walkExpression(arg, context, jsxNode);
    }
    return;
  }

  // Ternary: cond ? "a" : "b"
  if (expr.type === "ConditionalExpression") {
    walkExpression(expr.consequent, context, jsxNode);
    walkExpression(expr.alternate, context, jsxNode);
    return;
  }

  // Logical: cond && "x"
  if (expr.type === "LogicalExpression") {
    walkExpression(expr.left, context, jsxNode);
    walkExpression(expr.right, context, jsxNode);
    return;
  }

  // Binary +: "foo " + (cond ? "bg-red-500" : "bg-blue-500")
  if (expr.type === "BinaryExpression" && expr.operator === "+") {
    walkExpression(expr.left, context, jsxNode);
    walkExpression(expr.right, context, jsxNode);
    return;
  }

  // Object literal (cva variants): { variant: { primary: "bg-red-500" } }
  if (expr.type === "ObjectExpression") {
    for (const prop of expr.properties) {
      if (prop.type === "Property" || prop.type === "ObjectProperty") {
        walkExpression(prop.value, context, jsxNode);
      }
    }
    return;
  }

  // Array literal
  if (expr.type === "ArrayExpression") {
    for (const elem of expr.elements) {
      walkExpression(elem, context, jsxNode);
    }
  }
}

export default rule;
