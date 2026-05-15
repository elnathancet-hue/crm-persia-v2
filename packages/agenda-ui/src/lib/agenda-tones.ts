// PR9d (Agenda polish): tons semanticos centralizados.
//
// Por que existir: status badges + alertas da Agenda usavam classes
// Tailwind cruas espalhadas (bg-amber-100, dark:bg-amber-500/15, etc).
// Visualmente inconsistente: cada componente escolhia opacidade,
// intensidade e estilo de borda diferente. Mudar paleta = caçar
// dezenas de lugares.
//
// Solucao: 1 mapa central `TONE_CLASSES` por intencao semantica.
// Cada componente importa e consome via tom (warning, success, info...).
//
// PR-COLOR-SWEEP (mai/2026): migrado de cores cromaticas (amber/emerald/
// blue/sky/rose-*) pros tokens semanticos do design system. Light/dark
// resolve automaticamente via CSS vars em globals.css. Trocar paleta
// agora e 1 edicao em globals.css, nao 56 classes aqui.

export type AgendaTone =
  | "brand" // primary tokens — destaque visual da marca (overview KPI, menus)
  | "warning" // amber → warning token — aguardando, rascunho, alerta de mudanca
  | "success" // emerald → success token — confirmado, ativo, OK
  | "info" // blue → primary — concluido / informativo
  | "accent" // sky → chart-2 — reagendado / acao secundaria (token de variacao)
  | "danger" // destructive — cancelado / erro
  | "neutral"; // muted — no_show, inativo, secundario

/**
 * Classes para badge-pill (compactos, uppercase, com ring inset).
 * Aplicar junto com:
 *   inline-flex items-center rounded-full px-2 py-0.5 text-xs
 *   font-medium uppercase tracking-wide ring-1 ring-inset
 */
export const TONE_BADGE_CLASSES: Record<AgendaTone, string> = {
  brand: "bg-primary/10 text-primary ring-primary/30",
  warning: "bg-warning-soft text-warning-soft-foreground ring-warning-ring",
  success: "bg-success-soft text-success-soft-foreground ring-success-ring",
  info: "bg-primary/10 text-primary ring-primary/30",
  accent: "bg-chart-2/15 text-chart-2 ring-chart-2/40",
  danger: "bg-destructive/10 text-destructive ring-destructive/30",
  neutral: "bg-muted text-muted-foreground ring-border",
};

/**
 * Classes para alert-box (caixas de aviso com texto explicativo).
 * Aplicar junto com:
 *   rounded-md p-3 text-sm ring-1
 */
export const TONE_ALERT_CLASSES: Record<AgendaTone, string> = {
  brand: "bg-primary/5 text-foreground ring-primary/20",
  warning: "bg-warning-soft text-warning-soft-foreground ring-warning-ring",
  success: "bg-success-soft text-success-soft-foreground ring-success-ring",
  info: "bg-primary/5 text-primary ring-primary/20",
  accent: "bg-chart-2/10 text-chart-2 ring-chart-2/30",
  danger: "bg-destructive/10 text-destructive ring-destructive/30",
  neutral: "bg-muted text-muted-foreground ring-border",
};

/**
 * Classes para tone pill (chip simples sem ring, usado em overview/menu).
 * Aplicar junto com:
 *   inline-flex items-center rounded-md px-2 py-0.5 text-xs
 */
export const TONE_PILL_CLASSES: Record<AgendaTone, string> = {
  brand: "bg-primary/10 text-primary",
  warning: "bg-warning-soft text-warning-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  info: "bg-primary/10 text-primary",
  accent: "bg-chart-2/15 text-chart-2",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};
