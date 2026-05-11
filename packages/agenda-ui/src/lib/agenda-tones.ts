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
// Padrao visual unificado:
//   - bg de baixa intensidade (50/15) pra nao competir com conteudo
//   - texto de alta legibilidade (700/300)
//   - ring sutil (200/30) — alinha com pattern shadcn
//
// Como evoluir: quando o design system promover --status-* CSS vars,
// trocar as classes aqui sem mexer em quem consome. Single point of
// change.

export type AgendaTone =
  | "warning" // amber — aguardando confirmacao, rascunho, alerta de mudanca
  | "success" // emerald — confirmado, ativo, OK
  | "info" // blue — concluido / informativo
  | "accent" // sky — reagendado / acao secundaria
  | "danger" // destructive — cancelado / erro
  | "neutral"; // muted — no_show, inativo, secundario

/**
 * Classes para badge-pill (compactos, uppercase, com ring inset).
 * Aplicar junto com:
 *   inline-flex items-center rounded-full px-2 py-0.5 text-xs
 *   font-medium uppercase tracking-wide ring-1 ring-inset
 */
export const TONE_BADGE_CLASSES: Record<AgendaTone, string> = {
  warning:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  success:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  info:
    "bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  accent:
    "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
  danger:
    "bg-destructive/10 text-destructive ring-destructive/30 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  neutral: "bg-muted text-muted-foreground ring-border",
};

/**
 * Classes para alert-box (caixas de aviso com texto explicativo).
 * Aplicar junto com:
 *   rounded-md p-3 text-sm ring-1
 */
export const TONE_ALERT_CLASSES: Record<AgendaTone, string> = {
  warning:
    "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  success:
    "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  info:
    "bg-blue-50 text-blue-900 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30",
  accent:
    "bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  danger:
    "bg-destructive/10 text-destructive ring-destructive/30 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
  neutral: "bg-muted text-muted-foreground ring-border",
};

/**
 * Classes para tone pill (chip simples sem ring, usado em overview/menu).
 * Aplicar junto com:
 *   inline-flex items-center rounded-md px-2 py-0.5 text-xs
 */
export const TONE_PILL_CLASSES: Record<AgendaTone, string> = {
  warning:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  success:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  info:
    "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  accent:
    "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  danger:
    "bg-destructive/10 text-destructive dark:bg-rose-500/10 dark:text-rose-300",
  neutral: "bg-muted text-muted-foreground",
};
