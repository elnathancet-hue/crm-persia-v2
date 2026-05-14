/**
 * named-input
 *
 * `<Input>` e `<Textarea>` do @persia/ui devem ter atributo `name=` definido.
 * Por que:
 *   - Autofill de senha/email do browser depende de `name`
 *   - Screen readers anunciam o `name` em alguns contextos
 *   - Forms que enviam via FormData precisam de name
 *
 * Fix: adicionar `name="..."` no componente. Ex: `<Input id="tag-name" name="tag_name" ... />`.
 *
 * Ver Sprint 2 (PR #179) e packages/ui/docs/patterns.md.
 */

const TARGET_COMPONENTS = new Set(["Input", "Textarea"]);

function hasNameAttribute(openingElement) {
  for (const attr of openingElement.attributes) {
    if (attr.type === "JSXAttribute" && attr.name?.name === "name") {
      return true;
    }
    // <Input {...spread} /> — assume spread tem name (não dá pra inferir)
    if (attr.type === "JSXSpreadAttribute") {
      return true;
    }
  }
  return false;
}

function hasTypeHidden(openingElement) {
  for (const attr of openingElement.attributes) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name?.name === "type" &&
      attr.value?.type === "Literal" &&
      attr.value.value === "hidden"
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Exige atributo `name=` em <Input> e <Textarea> do @persia/ui (a11y + autofill).",
      recommended: true,
    },
    schema: [],
    messages: {
      missingName:
        "<{{component}}> deve ter atributo `name=`. Necessário pra autofill e a11y. Ex: `<{{component}} id=\"...\" name=\"campo_nome\" />`.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name?.type !== "JSXIdentifier") return;
        const component = node.name.name;
        if (!TARGET_COMPONENTS.has(component)) return;
        if (hasTypeHidden(node)) return; // hidden inputs não precisam
        if (hasNameAttribute(node)) return;
        context.report({
          node,
          messageId: "missingName",
          data: { component },
        });
      },
    };
  },
};

export default rule;
