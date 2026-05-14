/**
 * no-bare-date-in-jsx
 *
 * Detecta `Date.now()`, `new Date(...).toLocaleString()`, `formatDistanceToNow(...)`,
 * `formatDistance(...)` ou helpers locais de "formato relativo" usados DIRETAMENTE
 * dentro de JSX. Sem o `<RelativeTime />` wrapper, o servidor e o cliente
 * renderizam valores ligeiramente diferentes (ms de diferença entre os
 * renders) e o React dispara o erro #418 (hydration mismatch).
 *
 * Fix: usar `<RelativeTime iso={x} formatter={formatRelativeShortPtBR} />`
 * do @persia/ui. SSR mostra a data absoluta, hydration troca pro relativo.
 *
 * Ver Sprint 3c (PR #182) e packages/ui/docs/patterns.md (Pattern #2).
 */

const FORBIDDEN_IDENTIFIERS = new Set([
  "formatDistanceToNow",
  "formatDistance",
  "formatRelative",
  "formatRelativeShort",
]);

function isDateNowCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.name === "Date" &&
    node.callee.property?.name === "now"
  );
}

function isNewDateChain(node) {
  // Captura new Date(x).toLocaleString() / .toLocaleDateString() / .toLocaleTimeString()
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "NewExpression" &&
    node.callee.object?.callee?.name === "Date" &&
    typeof node.callee.property?.name === "string" &&
    node.callee.property.name.startsWith("toLocale")
  );
}

function isForbiddenIdentifierCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    FORBIDDEN_IDENTIFIERS.has(node.callee.name)
  );
}

function checkExpression(expr, context, jsxNode) {
  if (!expr) return;

  if (
    isDateNowCall(expr) ||
    isNewDateChain(expr) ||
    isForbiddenIdentifierCall(expr)
  ) {
    context.report({
      node: jsxNode || expr,
      messageId: "noBareDateInJsx",
    });
    return;
  }

  // Template strings com interpolação contendo data
  if (expr.type === "TemplateLiteral") {
    for (const inner of expr.expressions) {
      checkExpression(inner, context, jsxNode || inner);
    }
    return;
  }

  // Concat com + : `"Última msg: " + formatRelativeShort(x)` (raro mas pega)
  if (expr.type === "BinaryExpression" && expr.operator === "+") {
    checkExpression(expr.left, context, jsxNode);
    checkExpression(expr.right, context, jsxNode);
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Proíbe `Date.now()` / `new Date().toLocaleString()` / `formatDistanceToNow` / `formatRelativeShort` direto em JSX (causa React #418). Use <RelativeTime /> do @persia/ui.",
      recommended: true,
    },
    schema: [],
    messages: {
      noBareDateInJsx:
        "Não use Date.now() / new Date().toLocaleX() / formatDistanceToNow / formatRelativeShort direto em JSX — causa hydration mismatch (React #418). Use <RelativeTime iso={x} /> do @persia/ui (Sprint 3c, PR #182).",
    },
  },
  create(context) {
    return {
      JSXExpressionContainer(node) {
        checkExpression(node.expression, context, node);
      },
    };
  },
};

export default rule;
