/**
 * no-style-override-on-primitive
 *
 * Detecta uso de classes Tailwind visuais (bg, border, shadow, ring,
 * hover:, data-[state=active]:, etc) passadas em primitivos do
 * @persia/ui. Forca o desenvolvedor a corrigir o primitivo em vez de
 * remendar caso-a-caso.
 *
 * Regra dura — memoria/feedback_ds_primitive_rule.md.
 *
 * Componentes monitorados (PRIMITIVES):
 *   Input, Textarea, Select, SelectTrigger, Button, TabsList, TabsTrigger,
 *   DropdownMenuItem, DropdownMenuContent, ActionMenu, Card, Badge,
 *   DialogContent, DialogHeader, DialogFooter
 *
 * Classes BLOQUEADAS (visual identity do primitivo):
 *   bg-*, hover:bg-*, data-active:bg-*, data-[state=active]:bg-*
 *   border-* (exceto border-none), hover:border-*, data-active:border-*
 *   ring-*, hover:ring-*, data-active:ring-*
 *   shadow-* (exceto shadow-none)
 *   text-{cromatico}-* (exceto muted-foreground / foreground / destructive)
 *
 * Classes PERMITIDAS (layout/posicao — nao visual):
 *   w-*, h-*, min-*, max-*, size-*
 *   p[xytrbl]?-*, m[xytrbl]?-*, space-*
 *   flex*, grid*, gap-*, col-*, row-*
 *   justify-*, items-*, self-*, place-*
 *   absolute|relative|fixed|sticky
 *   top-|bottom-|left-|right-|inset-
 *   z-*, overflow-*, truncate, line-clamp-*
 *   opacity-*, transition-*, duration-*
 *
 * Escape hatch:
 *   // eslint-disable-next-line @persia/no-style-override-on-primitive -- razao
 *
 * Severity: warn (transicional). Promover pra error quando o sweep
 * estabilizar.
 */

const PRIMITIVES = new Set([
  "Input",
  "Textarea",
  "Select",
  "SelectTrigger",
  "Button",
  "TabsList",
  "TabsTrigger",
  "DropdownMenuItem",
  "DropdownMenuContent",
  "ActionMenu",
  "Card",
  "Badge",
  "DialogContent",
  "DialogHeader",
  "DialogFooter",
]);

// Regex pra classes BLOQUEADAS — visual identity do primitivo.
// Captura classes diretas + variant prefixes (hover:, focus:, data-...:).
function isBlocked(cls) {
  // Layout/positioning — sempre permitido
  if (
    /^(w|h|min|max|size)-/.test(cls) ||
    /^p[xytrbl]?-/.test(cls) ||
    /^m[xytrbl]?-/.test(cls) ||
    /^space-/.test(cls) ||
    /^(flex|grid|gap|col|row|order)-?/.test(cls) ||
    /^(justify|items|self|place)-/.test(cls) ||
    /^(absolute|relative|fixed|sticky|static)$/.test(cls) ||
    /^(top|bottom|left|right|inset)-/.test(cls) ||
    /^z-/.test(cls) ||
    /^overflow-/.test(cls) ||
    /^(truncate|line-clamp-\d+)$/.test(cls) ||
    /^opacity-/.test(cls) ||
    /^(transition|duration|ease|delay)-/.test(cls) ||
    /^cursor-/.test(cls) ||
    /^pointer-events-/.test(cls) ||
    /^select-/.test(cls) ||
    /^outline-/.test(cls) ||
    /^aspect-/.test(cls) ||
    /^object-/.test(cls)
  ) {
    return false;
  }

  // Remove variant prefix (hover:, focus:, dark:, data-...:, group-...:)
  const cleaned = cls.replace(/^[a-z-]+\[[^\]]*\]:/, "").replace(/^[a-z-]+:/g, "");

  // bg, hover:bg, etc — bloqueado, EXCETO bg-transparent (layout)
  if (/^bg-/.test(cleaned) && cleaned !== "bg-transparent") return true;

  // border — bloqueado exceto border-none
  if (/^border-/.test(cleaned) && cleaned !== "border-none") return true;

  // ring — bloqueado
  if (/^ring-/.test(cleaned)) return true;

  // shadow — bloqueado exceto shadow-none
  if (/^shadow-/.test(cleaned) && cleaned !== "shadow-none") return true;

  // text-* — bloqueado exceto neutros do DS
  if (/^text-/.test(cleaned)) {
    const allowed = [
      "text-foreground",
      "text-muted-foreground",
      "text-destructive",
      "text-card-foreground",
      "text-primary-foreground",
      "text-secondary-foreground",
      "text-accent-foreground",
      "text-popover-foreground",
      "text-sidebar-foreground",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-3xl",
      "text-xs",
      "text-[10px]",
      "text-[11px]",
      "text-center",
      "text-left",
      "text-right",
      "text-balance",
      "text-pretty",
      "text-wrap",
      "text-nowrap",
    ];
    if (!allowed.includes(cleaned)) return true;
  }

  return false;
}

function extractClassNames(value) {
  if (!value) return [];
  if (value.type === "Literal" && typeof value.value === "string") {
    return value.value.split(/\s+/).filter(Boolean);
  }
  if (value.type === "JSXExpressionContainer") {
    return extractFromExpression(value.expression);
  }
  return [];
}

function extractFromExpression(expr) {
  if (!expr) return [];
  if (expr.type === "Literal" && typeof expr.value === "string") {
    return expr.value.split(/\s+/).filter(Boolean);
  }
  if (expr.type === "TemplateLiteral") {
    const classes = [];
    for (const quasi of expr.quasis) {
      if (quasi.value?.cooked) {
        classes.push(...quasi.value.cooked.split(/\s+/).filter(Boolean));
      }
    }
    return classes;
  }
  if (expr.type === "CallExpression") {
    // cn(...) / clsx(...)
    const classes = [];
    for (const arg of expr.arguments) {
      classes.push(...extractFromExpression(arg));
    }
    return classes;
  }
  if (expr.type === "ConditionalExpression") {
    return [
      ...extractFromExpression(expr.consequent),
      ...extractFromExpression(expr.alternate),
    ];
  }
  if (expr.type === "LogicalExpression") {
    return [
      ...extractFromExpression(expr.left),
      ...extractFromExpression(expr.right),
    ];
  }
  return [];
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Proíbe className visuais (bg, border, ring, shadow, hover:, etc) em primitivos do @persia/ui. Corrija no primitivo, não no consumidor. Ver memory/feedback_ds_primitive_rule.md.",
      recommended: true,
    },
    schema: [],
    messages: {
      blocked:
        "`{{cls}}` em <{{component}}> é override visual do primitivo. Corrija em packages/ui/src/components/{{file}}.tsx — o DS deve mandar no produto, não remendos por consumidor.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name;
        // Só JSXIdentifier (não JSXMemberExpression como Action.Menu)
        if (name.type !== "JSXIdentifier") return;
        if (!PRIMITIVES.has(name.name)) return;

        const classNameAttr = node.attributes.find(
          (a) =>
            a.type === "JSXAttribute" &&
            a.name &&
            a.name.name === "className",
        );
        if (!classNameAttr) return;

        const classes = extractClassNames(classNameAttr.value);
        for (const cls of classes) {
          if (isBlocked(cls)) {
            const componentName = name.name;
            const fileName =
              componentName.charAt(0).toLowerCase() +
              componentName
                .slice(1)
                .replace(/([A-Z])/g, "-$1")
                .toLowerCase();
            context.report({
              node: classNameAttr,
              messageId: "blocked",
              data: { cls, component: componentName, file: fileName },
            });
            return; // Reporta só a 1a por elemento — evita spam
          }
        }
      },
    };
  },
};

export default rule;
