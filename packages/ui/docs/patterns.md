# `@persia/ui` — patterns

Padrões obrigatórios pra features novas no CRM Persia v2.

Aprovado em 2026-05-13 após auditoria E2E. Cobrem ~80% dos bugs estruturais
detectados em prod. Ver detalhes em
`memory/project_architecture_layers.md` e `memory/project_prod_bugs_pending_post_wave4.md`.

---

## Índice

1. [`useDialogMutation`](#1-usedialogmutation) — Dialog/AlertDialog com mutation
2. [`<RelativeTime />`](#2-relativetime) — timestamp relativo sem hydration mismatch
3. [Server action contract](#3-server-action-contract) — `{ data, error } | void`, nunca throw
4. [`useOptimisticList`](#4-useoptimisticlist) — mutations em listas sem stale state
5. [`<RemoteForm />`](#5-remoteform) — forms com Zod + server action

---

## 1. `useDialogMutation`

**Problema que resolve:** 6 ocorrências em prod de "dialog não fecha após save"
(B-S1 Nova segmentação, B-S4 Excluir segmento, B-T1/T2/T3 Tags CRUD, PR-B3
LeadInfoDrawer save). Cada componente reinventa o handler de close/toast/error,
alguns esquecem `setOpen(false)` no success path.

### API

```ts
// packages/ui/src/hooks/use-dialog-mutation.ts
import { useTransition } from "react";
import { toast } from "sonner";

export interface UseDialogMutationOptions<Input, Output> {
  /** Server action ou função que faz a mutation. */
  mutation: (input: Input) => Promise<{ data?: Output; error?: string } | void>;
  /** Callback do Dialog/Sheet/AlertDialog (sempre controlled). */
  onOpenChange: (open: boolean) => void;
  /** Mensagem de toast no path de sucesso. */
  successToast: string;
  /** Mensagem fallback de erro (se `error` não vier da action). */
  errorToast?: string;
  /** Callback opcional pós-sucesso (refetch, redirect, etc). */
  onSuccess?: (data: Output | undefined) => void;
  /** Toast ID estável (default: random) — usar quando o user re-clica em sequência. */
  toastId?: string;
}

export function useDialogMutation<Input, Output>(
  opts: UseDialogMutationOptions<Input, Output>,
) {
  const [isPending, startTransition] = useTransition();

  const submit = (input: Input) => {
    startTransition(async () => {
      try {
        const result = await opts.mutation(input);
        if (result && "error" in result && result.error) {
          toast.error(result.error, { id: opts.toastId });
          return;
        }
        toast.success(opts.successToast, {
          id: opts.toastId,
          duration: 5000,
        });
        opts.onOpenChange(false);
        opts.onSuccess?.(result && "data" in result ? result.data : undefined);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : opts.errorToast ?? "Erro ao salvar",
          { id: opts.toastId },
        );
      }
    });
  };

  return { submit, isPending };
}
```

### Uso

```tsx
// packages/tags-ui/src/components/EditTagDialog.tsx
export function EditTagDialog({ tag, open, onOpenChange }: Props) {
  const actions = useTagsActions();
  const { submit, isPending } = useDialogMutation({
    mutation: (input: UpdateTagInput) => actions.updateTag(tag.id, input),
    onOpenChange,
    successToast: "Tag atualizada",
    toastId: `tag-${tag.id}-edit`,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); submit({ name: e.currentTarget.name.value }); }}>
          {/* fields */}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### Quando NAO usar
- Mutations fora de Dialog (botão "Salvar" inline no drawer) → usar `toast.success` direto + custom logic
- Mutations sem feedback visual (logs internos) → usar `startTransition` direto

---

## 2. `<RelativeTime />`

**Problema que resolve:** React error #418 (hydration mismatch) que disparou
16 vezes em 1.5h de auditoria mesmo após PR-B8 cobrir 5 spots. Cada novo
componente que renderiza data relativa repete o bug. PR-B8 foi sintomático
— este pattern é **estrutural**.

### API

```tsx
// packages/ui/src/components/relative-time.tsx
"use client";
import { useEffect, useState } from "react";

interface RelativeTimeProps {
  iso: string | null | undefined;
  /** Fallback enquanto não hidrata (default: "") */
  fallback?: string;
  className?: string;
  /** Re-render a cada N ms (default: 60_000 = 1 min) */
  refreshMs?: number;
}

export function RelativeTime({
  iso,
  fallback = "",
  className,
  refreshMs = 60_000,
}: RelativeTimeProps) {
  // SSR: renderiza fallback (vazio) — evita mismatch com cliente
  const [text, setText] = useState(fallback);

  useEffect(() => {
    if (!iso) {
      setText(fallback);
      return;
    }
    const update = () => setText(formatRelative(iso));
    update();
    const interval = setInterval(update, refreshMs);
    return () => clearInterval(interval);
  }, [iso, fallback, refreshMs]);

  return (
    <span
      className={className}
      title={iso ? new Date(iso).toLocaleString("pt-BR") : undefined}
    >
      {text}
    </span>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
```

### Uso

```tsx
// Antes (bug #418)
<span>{formatRelativeShort(deal.updated_at)}</span>

// Depois
<RelativeTime iso={deal.updated_at} className="text-xs text-muted-foreground" />
```

### ESLint rule

Lint rule custom `no-bare-date-in-jsx` proíbe `Date.now()`, `new Date()`,
`.toLocaleString()`, `.toLocaleDateString()` em retorno de JSX (apenas
permitido em `useEffect`, `useMemo`, ou utility functions).

---

## 3. Server action contract

**Problema que resolve:** Server actions que `throw new Error(...)` em caso
de auth/validation fail viram HTTP 500 + Server Components render error
genérico (bug #1 do login). Try/catch no client em `startTransition` NÃO
captura esse throw via React 19.

### Contract

```ts
// Toda server action retorna ESTE shape:
type ActionResult<T = void> = { data?: T; error?: string } | T | void;

// Sucesso com payload
export async function createLead(input: Input): Promise<{ data: Lead } | { error: string }> {
  if (!authorized) return { error: "Você não tem permissão" };
  const lead = await db.from("leads").insert(...).select().single();
  if (lead.error) return { error: lead.error.message };
  return { data: lead.data };
}

// Sucesso sem payload (só redirect)
export async function signIn(formData: FormData): Promise<{ error: string } | void> {
  const { error } = await supabase.auth.signInWithPassword(...);
  if (error) return { error: "Email ou senha incorretos." };
  revalidatePath("/");
  redirect("/"); // throws NEXT_REDIRECT — OK, tratado pelo router
}

// Sucesso void + revalidate
export async function deleteLead(id: string): Promise<{ error: string } | void> {
  if (!authorized) return { error: "Não autorizado" };
  await db.from("leads").delete().eq("id", id);
  revalidatePath("/leads");
  // void implícito = sucesso
}
```

### O que NÃO fazer

```ts
// ❌ Bad — vira 500 no client
export async function signIn(formData: FormData) {
  if (error) throw new Error(error.message);
}

// ❌ Bad — mistura return + throw
export async function update(id: string, data: any) {
  if (!ok) throw new Error("Sem permissão");
  return { data: result };
}
```

### Combinação com `useDialogMutation`
O hook entende o contract: `{ error }` → `toast.error` sem fechar dialog;
`{ data } | void` → `toast.success` + `onOpenChange(false)`.

---

## 4. `useOptimisticList`

**Problema que resolve:** Drawer não atualiza pills de tag após `addTagToLead`
(bug #B-N6). Counter do card de segmento mostra "0 leads" mas filtro retorna 2
(B-S3). `router.refresh()` resolve no server component pai, mas client
components com estado local ficam stale.

### API (React 19 `useOptimistic` wrapper)

```ts
// packages/ui/src/hooks/use-optimistic-list.ts
import { useOptimistic } from "react";

export function useOptimisticList<T>(
  initialList: T[],
  matchKey: (item: T) => string,
) {
  const [list, applyOptimistic] = useOptimistic(
    initialList,
    (state, action: { type: "add"; item: T } | { type: "remove"; id: string }) => {
      if (action.type === "add") {
        if (state.some((i) => matchKey(i) === matchKey(action.item))) return state;
        return [...state, action.item];
      }
      return state.filter((i) => matchKey(i) !== action.id);
    },
  );

  return { list, applyOptimistic };
}
```

### Uso

```tsx
function TagsSectionDrawer({ leadId, initialTags }: Props) {
  const actions = useLeadsActions();
  const { list: tags, applyOptimistic } = useOptimisticList(initialTags, (t) => t.id);

  const handleAddTag = (tag: Tag) => {
    applyOptimistic({ type: "add", item: tag }); // UI atualiza ja
    actions.addTagToLead(leadId, tag.id).then((r) => {
      if (r?.error) {
        toast.error(r.error);
        // useOptimistic auto-reverte se server retornar falha + revalidate
      }
    });
  };
  // ...
}
```

### Quando NÃO usar
- Mutations que mudam ordem complexa (use `useReducer`)
- Operações em lote (use Server Actions com revalidatePath inteligente)

---

## 5. `<RemoteForm />`

**Problema que resolve:** forms reinventam validação Zod + onSubmit + close +
toast. Inconsistência em validation timing (alguns inline no blur, outros no
submit). Padrão único pra todo form que cria/edita.

### API (minimum viable — pode evoluir)

```tsx
// packages/ui/src/components/remote-form.tsx
"use client";
import { useState, type FormEvent } from "react";
import { z, type ZodType } from "zod";
import { useDialogMutation } from "../hooks/use-dialog-mutation";

interface RemoteFormProps<Schema extends ZodType> {
  schema: Schema;
  action: (input: z.infer<Schema>) => Promise<{ data?: any; error?: string } | void>;
  defaultValues?: Partial<z.infer<Schema>>;
  onOpenChange?: (open: boolean) => void;
  successToast: string;
  onSuccess?: (data: any) => void;
  children: React.ReactNode;
  /** Toast id pra dedup re-clicks */
  toastId?: string;
}

export function RemoteForm<S extends ZodType>({
  schema,
  action,
  onOpenChange = () => {},
  successToast,
  onSuccess,
  children,
  toastId,
}: RemoteFormProps<S>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, isPending } = useDialogMutation({
    mutation: action,
    onOpenChange,
    successToast,
    onSuccess,
    toastId,
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries());
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    submit(result.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <RemoteFormContext.Provider value={{ errors, isPending }}>
        {children}
      </RemoteFormContext.Provider>
    </form>
  );
}
```

### Uso

```tsx
<RemoteForm
  schema={tagCreateSchema}
  action={createTag}
  onOpenChange={onOpenChange}
  successToast="Tag criada"
  toastId={`tag-create`}
>
  <Field name="name" label="Nome" />
  <Field name="color" label="Cor" type="color" />
  <Submit>Criar tag</Submit>
</RemoteForm>
```

`<Field>` e `<Submit>` consomem `RemoteFormContext` pra mostrar erro inline e
disable durante pending.

---

## 🛡️ Patterns auxiliares (referência rápida)

### Toast IDs estáveis pra dedup
```ts
toast.success("Lead atualizado", {
  id: `lead-${leadId}-update`,
  duration: 5000,
});
```

### Inputs com `name=` (a11y + autofill)
```tsx
<Input name="lead_name" value={form.name} onChange={...} />
```

### Botões só com ícone
```tsx
<Button aria-label="Editar tag" size="icon-xs">
  <Pencil />
</Button>
```

### Headers sortable
```tsx
<th aria-sort={sortBy === "name" ? sortDir : "none"}>
  <button onClick={() => toggleSort("name")}>Nome</button>
</th>
```

### PT-BR com acentos (sempre)
✅ "Informações", "Negócio", "Automação", "Relatório", "será removida"
❌ "Informacoes", "Negocio", "Automacao", "Relatorio", "sera removida"

---

## 🚦 Roadmap de implementação

- **Sprint 0** (3 dias): este doc + `architecture_layers.md` + PR template
- **Sprint 1**: implementar `useDialogMutation`, `<RelativeTime />`, `<RemoteForm />` (1 semana)
- **Sprint 2**: piloto Tags CRUD + lint rules em CI (1 semana)
- **Sprint 3**: migração em massa pros outros 4 lugares (2 semanas)
- **Sprint 4**: decisão #17 + cascata (1 semana)
- **Sprint 5**: i18n + a11y sweep (1 semana)
