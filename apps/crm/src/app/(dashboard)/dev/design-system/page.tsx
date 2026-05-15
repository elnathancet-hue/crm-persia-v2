"use client";

// /dev/design-system — playground vivo do DS Pérsia.
//
// PR 10/10 fase 6 (mai/2026): documentacao executavel dos tokens
// semanticos + componentes nucleares do design system. Acessivel
// pelos devs durante implementacao de novas telas — em vez de ler
// codigo, abre a rota e ve tudo em acao.
//
// Coberto:
// - Tokens de cor: success/failure/progress/warning (+ soft/ring)
//   + brand (primary/secondary) + neutros (muted/border)
//   + chart-1..5
// - Tokens de spacing: card / section / stack / form / inline
// - Tipografia: <PageTitle>, <SectionLabel>, <KpiValue>, <MutedHint>
// - Status: <TagBadge>, <StageBadge>
// - Layout: <DialogShell> (preview estatico)
//
// Como evoluir: cada token/componente novo do DS ganha uma entry aqui.

import {
  PageTitle,
  SectionLabel,
  KpiValue,
  MutedHint,
} from "@persia/ui/typography";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { TagBadge } from "@persia/tags-ui";
import { StageBadge } from "@persia/crm-ui";
import { Contact, Sparkles } from "lucide-react";

// NOTA: 'use client' acima porque renderiza onRemove handler em TagBadge
// pra mostrar o variant com botao de remover. Pagina nao tem state real —
// e so um catalogo visual.

// --- Sample data ------------------------------------------------------------

const TAGS = [
  { id: "1", name: "Quente", color: "#EF4444" },
  { id: "2", name: "Negociando", color: "#3B82F6" },
  { id: "3", name: "Cliente", color: "#16A34A" },
  { id: "4", name: "Premium", color: "#A855F7" },
];

// --- Token swatches ---------------------------------------------------------

function ColorSwatch({
  bg,
  label,
  fg,
}: {
  bg: string;
  label: string;
  fg?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`h-16 rounded-xl border border-border ${bg} ${fg ?? ""} flex items-center justify-center text-xs font-medium`}
      >
        {fg ? "Aa" : ""}
      </div>
      <code className="text-[10px] text-muted-foreground font-mono leading-tight">
        {label}
      </code>
    </div>
  );
}

function OutcomeTokens({
  name,
  baseClass,
}: {
  name: string;
  baseClass: string;
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>{name}</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ColorSwatch
          bg={`bg-${baseClass} text-${baseClass}-foreground`}
          fg=" "
          label={`bg-${baseClass}`}
        />
        <ColorSwatch
          bg={`bg-${baseClass}-soft text-${baseClass}-soft-foreground`}
          fg=" "
          label={`bg-${baseClass}-soft`}
        />
        <ColorSwatch
          bg={`border-2 border-${baseClass}-ring`}
          label={`border-${baseClass}-ring`}
        />
      </div>
    </div>
  );
}

// --- Page -------------------------------------------------------------------

export default function DesignSystemPlaygroundPage() {
  return (
    <div className="space-y-section pb-section">
      {/* Header */}
      <header className="space-y-2">
        <PageTitle>Design System</PageTitle>
        <MutedHint>
          Playground vivo dos tokens + componentes. Bate ESLint? Vê aqui antes
          de hardcode. {"  "}
          <code className="text-foreground">apps/crm/src/app/globals.css</code>
        </MutedHint>
      </header>

      {/* Outcome tokens */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          1. Outcome tokens
        </PageTitle>
        <MutedHint>
          4 outcomes semânticos. Light + dark resolvem via CSS var. Cada um tem
          3 facets: solid (bg + foreground), soft (bg-soft + soft-foreground) e
          ring (border).
        </MutedHint>
        <div className="grid gap-stack md:grid-cols-2">
          <OutcomeTokens name="success" baseClass="success" />
          <OutcomeTokens name="failure" baseClass="failure" />
          <OutcomeTokens name="progress" baseClass="progress" />
          <OutcomeTokens name="warning" baseClass="warning" />
        </div>
      </section>

      {/* Brand + neutros */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          2. Brand + neutros
        </PageTitle>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <ColorSwatch
            bg="bg-primary text-primary-foreground"
            fg=" "
            label="primary"
          />
          <ColorSwatch
            bg="bg-secondary text-secondary-foreground"
            fg=" "
            label="secondary"
          />
          <ColorSwatch
            bg="bg-destructive text-destructive-foreground"
            fg=" "
            label="destructive"
          />
          <ColorSwatch
            bg="bg-muted text-muted-foreground"
            fg=" "
            label="muted"
          />
          <ColorSwatch
            bg="bg-card text-card-foreground"
            fg=" "
            label="card"
          />
        </div>
      </section>

      {/* Chart palette */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          3. Chart palette
        </PageTitle>
        <MutedHint>
          5 tokens pra variedade quando precisar de mais distinção que os 4
          outcomes (ex: KPIs em dashboard com 6 categorias).
        </MutedHint>
        <div className="grid grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <ColorSwatch
              key={n}
              bg={`bg-chart-${n}`}
              fg=" "
              label={`chart-${n}`}
            />
          ))}
        </div>
      </section>

      {/* Spacing tokens */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          4. Spacing tokens
        </PageTitle>
        <MutedHint>
          Use{" "}
          <code className="text-foreground">
            p-card / px-card-lg / gap-section / gap-stack / gap-form / gap-inline
          </code>
          {" "}em vez de chutar p-3/p-4/space-y-6.
        </MutedHint>
        <div className="space-y-stack">
          {[
            { name: "card", value: "24px", desc: "Padding interno de card" },
            { name: "card-lg", value: "32px", desc: "Padding de card largo" },
            { name: "section", value: "32px", desc: "Distância entre seções" },
            { name: "stack", value: "16px", desc: "Distância entre itens" },
            { name: "form", value: "16px", desc: "Gap de campos de form" },
            { name: "inline", value: "12px", desc: "Gap horizontal pequeno" },
          ].map((sp) => (
            <div
              key={sp.name}
              className="flex items-center gap-stack rounded-lg border border-border bg-card p-stack"
            >
              <div
                className="h-6 bg-primary/30 rounded-md shrink-0"
                style={{ width: sp.value }}
              />
              <div className="min-w-0 flex-1">
                <code className="text-xs font-mono">--spacing-{sp.name}</code>
                <p className="text-xs text-muted-foreground">{sp.desc}</p>
              </div>
              <code className="text-xs text-muted-foreground tabular-nums">
                {sp.value}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Tipografia */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          5. Tipografia
        </PageTitle>
        <Card>
          <CardContent className="p-card-lg space-y-stack">
            <div>
              <PageTitle>PageTitle (default)</PageTitle>
              <code className="text-[10px] text-muted-foreground">
                {`<PageTitle>...</PageTitle>`}
              </code>
            </div>
            <div>
              <PageTitle size="compact">PageTitle (compact)</PageTitle>
              <code className="text-[10px] text-muted-foreground">
                {`<PageTitle size="compact">...</PageTitle>`}
              </code>
            </div>
            <div className="space-y-1">
              <SectionLabel icon={Contact}>SectionLabel + icon</SectionLabel>
              <code className="text-[10px] text-muted-foreground">
                {`<SectionLabel icon={Contact}>...</SectionLabel>`}
              </code>
            </div>
            <div className="flex items-end gap-stack">
              <div>
                <KpiValue size="lg">1.234</KpiValue>
                <MutedHint>KpiValue size=lg</MutedHint>
              </div>
              <div>
                <KpiValue size="md">567</KpiValue>
                <MutedHint>size=md (default)</MutedHint>
              </div>
              <div>
                <KpiValue size="sm">89</KpiValue>
                <MutedHint>size=sm</MutedHint>
              </div>
            </div>
            <MutedHint>
              MutedHint — helper text padrao, sempre cinza, sempre pequeno.
            </MutedHint>
          </CardContent>
        </Card>
      </section>

      {/* TagBadge */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          6. TagBadge
        </PageTitle>
        <MutedHint>
          UMA fonte de verdade pra renderizar tag. Antes cada lugar inventava
          inline ({"`${tag.color}40`"}). Agora{" "}
          <code className="text-foreground">{`<TagBadge tag={tag} />`}</code>.
        </MutedHint>
        <Card>
          <CardContent className="p-card-lg space-y-form">
            <div>
              <SectionLabel>variant=&quot;solid&quot; (default)</SectionLabel>
              <div className="flex flex-wrap gap-2 mt-2">
                {TAGS.map((t) => (
                  <TagBadge key={t.id} tag={t} />
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>variant=&quot;soft&quot;</SectionLabel>
              <div className="flex flex-wrap gap-2 mt-2">
                {TAGS.map((t) => (
                  <TagBadge key={t.id} tag={t} variant="soft" />
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>com onRemove</SectionLabel>
              <div className="flex flex-wrap gap-2 mt-2">
                {TAGS.map((t) => (
                  <TagBadge
                    key={t.id}
                    tag={t}
                    variant="soft"
                    onRemove={() => {}}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* StageBadge */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          7. StageBadge
        </PageTitle>
        <MutedHint>
          Mapeia outcome de stage (em_andamento / falha / bem_sucedido) pros
          tokens semânticos. UMA tabela na codebase — antes eram 3 paralelas.
        </MutedHint>
        <Card>
          <CardContent className="p-card-lg space-y-form">
            <div>
              <SectionLabel>variant=&quot;soft&quot; (default)</SectionLabel>
              <div className="flex flex-wrap gap-2 mt-2">
                <StageBadge outcome="em_andamento">Contato</StageBadge>
                <StageBadge outcome="em_andamento">Negociação</StageBadge>
                <StageBadge outcome="bem_sucedido">Cliente</StageBadge>
                <StageBadge outcome="falha">Perdido</StageBadge>
              </div>
            </div>
            <div>
              <SectionLabel>variant=&quot;solid&quot;</SectionLabel>
              <div className="flex flex-wrap gap-2 mt-2">
                <StageBadge outcome="em_andamento" variant="solid">
                  Contato
                </StageBadge>
                <StageBadge outcome="bem_sucedido" variant="solid">
                  Cliente
                </StageBadge>
                <StageBadge outcome="falha" variant="solid">
                  Perdido
                </StageBadge>
              </div>
            </div>
            <div>
              <SectionLabel>variant=&quot;dot&quot;</SectionLabel>
              <div className="flex flex-wrap gap-stack mt-2">
                <StageBadge outcome="em_andamento" variant="dot">
                  Em fluxo
                </StageBadge>
                <StageBadge outcome="bem_sucedido" variant="dot">
                  Sucesso
                </StageBadge>
                <StageBadge outcome="falha" variant="dot">
                  Falha
                </StageBadge>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Buttons / Badges padrão shadcn */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          8. Button + Badge (shadcn)
        </PageTitle>
        <Card>
          <CardContent className="p-card-lg space-y-form">
            <div>
              <SectionLabel>Buttons</SectionLabel>
              <div className="flex flex-wrap gap-inline mt-2">
                <Button>Default</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
            </div>
            <div>
              <SectionLabel>Badges</SectionLabel>
              <div className="flex flex-wrap gap-inline mt-2">
                <Badge>Default</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Cheatsheet anti-bug */}
      <section className="space-y-stack">
        <PageTitle as="h2" size="compact">
          9. Cheatsheet anti-hardcode
        </PageTitle>
        <MutedHint>
          ESLint <code className="text-foreground">@persia/no-hardcoded-tailwind-color</code> está em
          {" "}<strong className="text-foreground">error</strong>. Não escreva
          cores cromáticas direto — use os tokens abaixo:
        </MutedHint>
        <Card>
          <CardContent className="p-card-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Não use</th>
                  <th className="pb-2">Use</th>
                  <th className="pb-2">Significado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["bg-emerald-500", "bg-success", "Positivo / ganho"],
                  ["bg-red-500", "bg-failure", "Negativo / perdido"],
                  ["bg-purple-500", "bg-progress", "Em andamento"],
                  ["bg-amber-500", "bg-warning", "Atenção / alerta"],
                  ["bg-blue-500", "bg-primary", "Ação principal / identidade"],
                  ["bg-gray-100", "bg-muted", "Neutro / disabled"],
                  ["bg-emerald-50 + dark:bg-emerald-500/10", "bg-success-soft", "Soft alert"],
                  ["text-emerald-600 dark:text-emerald-400", "text-success", "Texto positivo"],
                  ["#3B82F6 em style={{ }}", "var(--primary)", "Sempre via CSS var"],
                ].map(([bad, good, meaning]) => (
                  <tr key={bad}>
                    <td className="py-2 pr-3">
                      <code className="text-xs text-destructive line-through font-mono">
                        {bad}
                      </code>
                    </td>
                    <td className="py-2 pr-3">
                      <code className="text-xs text-success font-mono">
                        {good}
                      </code>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {meaning}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border pt-stack">
        <MutedHint>
          Mais detalhes em <code className="text-foreground">apps/crm/src/app/globals.css</code>{" "}
          (tokens) e <code className="text-foreground">packages/ui/src/components/typography.tsx</code>{" "}
          (tipografia). ESLint plugin:{" "}
          <code className="text-foreground">packages/eslint-plugin-persia/src/rules/no-hardcoded-tailwind-color.js</code>.
        </MutedHint>
        <div className="mt-2 flex items-center gap-inline text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-warning" />
          <span>PR 10/10 — design system base + sweep + gate + playground</span>
        </div>
      </footer>
    </div>
  );
}
