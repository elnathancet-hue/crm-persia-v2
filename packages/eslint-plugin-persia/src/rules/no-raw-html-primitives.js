/**
 * no-raw-html-primitives
 *
 * Detecta uso de <button>, <input>, <textarea>, <select> nativos do
 * HTML em codigo de aplicacao. Forca usar primitives do @persia/ui
 * (Button, Input, Textarea, Select) que sao consistentes em foco,
 * tamanho, hover, disabled e acessibilidade.
 *
 * PR-AUDIT (mai/2026): chat/template/CRM tinham buttons/inputs HTML
 * manuais com classes Tailwind ad-hoc. Cada um com hover/focus/
 * disabled diferente. Resultado: inconsistencia visual + perda de
 * acessibilidade automatica (Radix base-ui ja oferece a11y baked-in).
 *
 * Componentes monitorados (BLOCKED):
 *   <button>, <input>, <textarea>, <select>
 *
 * Excecoes (escape hatch):
 *   - <button> com aria-label especifico de menu close (X) interno
 *     ao DropdownMenu — usar // eslint-disable-next-line com razao
 *   - <input type="hidden"> — passa (nao tem visual)
 *   - <input type="file"> — passa por enquanto (Input nao suporta nativo)
 *   - <input type="checkbox"|"radio"> — passa (Checkbox/Radio sao
 *     pacotes separados)
 *
 * Severity: warn (transicional). Promover pra error apos sweep.
 */

const BLOCKED_TAGS = new Set(["button", "input", "textarea", "select"]);

function isExempted(node) {
  // <input> exempt types
  if (node.name.name === "input") {
    const typeAttr = node.attributes.find(
      (a) => a.type === "JSXAttribute" && a.name?.name === "type",
    );
    if (typeAttr?.value?.type === "Literal") {
      const t = typeAttr.value.value;
      if (t === "hidden" || t === "file" || t === "checkbox" || t === "radio") {
        return true;
      }
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Proíbe <button>/<input>/<textarea>/<select> HTML cru em código de aplicação. Use Button/Input/Textarea/Select do @persia/ui — consistente em foco, hover, disabled, a11y.",
      recommended: true,
    },
    schema: [],
    messages: {
      blocked:
        "Use <{{replacement}}> do @persia/ui em vez de <{{tag}}> HTML cru. Garante foco, hover, disabled, a11y consistentes em todo o app.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const tag = node.name.name;
        if (!BLOCKED_TAGS.has(tag)) return;
        if (isExempted(node)) return;

        const replacement = tag.charAt(0).toUpperCase() + tag.slice(1);
        context.report({
          node,
          messageId: "blocked",
          data: { tag, replacement },
        });
      },
    };
  },
};

export default rule;
