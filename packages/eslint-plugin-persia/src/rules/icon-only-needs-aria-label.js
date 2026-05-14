/**
 * icon-only-needs-aria-label
 *
 * <Button size="icon" /> ou <Button size="icon-sm" /> ou <Button size="icon-lg" />
 * (variantes "icon-only") precisam de `aria-label`. Sem texto visível,
 * screen reader fica sem nada pra anunciar.
 *
 * Também alerta quando o único filho é um SVG / ícone do lucide
 * (`<Pencil />`, `<Trash2 />`, etc) e não há `aria-label`.
 *
 * Fix: adicionar `aria-label="Editar tag X"` no botão.
 *
 * Ver Sprint 2 (PR #179) — botões da lista de Tags ganharam aria-label.
 */

const ICON_SIZE_VALUES = new Set(["icon", "icon-sm", "icon-lg"]);

// Lista parcial de ícones lucide-react / icons que aparecem como filho único.
// Usado como heurística — não exaustivo.
const ICON_COMPONENT_HINTS = new Set([
  "Pencil",
  "Trash2",
  "Plus",
  "X",
  "ChevronUp",
  "ChevronDown",
  "ChevronLeft",
  "ChevronRight",
  "MoreVertical",
  "MoreHorizontal",
  "Check",
  "Loader2",
  "Search",
  "Settings",
  "Edit",
  "Edit2",
  "Edit3",
]);

function getAttributeValue(openingElement, name) {
  for (const attr of openingElement.attributes) {
    if (attr.type === "JSXAttribute" && attr.name?.name === name) {
      if (attr.value?.type === "Literal") return attr.value.value;
      // attr value via expression — assume presente (não inspeciona dinâmico)
      return null;
    }
  }
  return undefined;
}

function hasAttribute(openingElement, name) {
  for (const attr of openingElement.attributes) {
    if (attr.type === "JSXAttribute" && attr.name?.name === name) {
      return true;
    }
    if (attr.type === "JSXSpreadAttribute") {
      // spread pode injetar aria-label — assume sim
      return true;
    }
  }
  return false;
}

function isIconElement(child) {
  if (child?.type === "JSXElement") {
    const name = child.openingElement?.name?.name;
    if (name === "svg") return true;
    if (ICON_COMPONENT_HINTS.has(name)) return true;
  }
  return false;
}

function getNonWhitespaceChildren(jsxElement) {
  return (jsxElement.children || []).filter((c) => {
    if (c.type === "JSXText") return c.value.trim().length > 0;
    return true;
  });
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Exige `aria-label` em botões icon-only (size=icon* ou filho único = ícone) — a11y.",
      recommended: true,
    },
    schema: [],
    messages: {
      iconButtonNeedsAriaLabel:
        "<Button> icon-only deve ter `aria-label` ou `title`. Sem texto visível, screen reader fica mudo. Ex: `<Button size=\"icon-sm\" aria-label=\"Editar\"><Pencil /></Button>`.",
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement;
        if (opening?.name?.type !== "JSXIdentifier") return;
        if (opening.name.name !== "Button") return;
        // Já tem aria-label ou title?
        if (hasAttribute(opening, "aria-label")) return;
        if (hasAttribute(opening, "title")) return;
        if (hasAttribute(opening, "aria-labelledby")) return;

        // Caso 1: size="icon*"
        const size = getAttributeValue(opening, "size");
        if (typeof size === "string" && ICON_SIZE_VALUES.has(size)) {
          context.report({
            node: opening,
            messageId: "iconButtonNeedsAriaLabel",
          });
          return;
        }

        // Caso 2: único filho é um ícone (SVG ou componente de ícone conhecido)
        const children = getNonWhitespaceChildren(node);
        if (children.length === 1 && isIconElement(children[0])) {
          context.report({
            node: opening,
            messageId: "iconButtonNeedsAriaLabel",
          });
        }
      },
    };
  },
};

export default rule;
