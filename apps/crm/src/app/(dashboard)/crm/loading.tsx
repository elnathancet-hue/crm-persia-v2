// PR-C5: skeleton neutro — nao presume qual tab vai carregar.
// Antes mostrava 4 colunas de Kanban mesmo quando ?tab=leads.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 pt-1">
      {/* Header + tabs skeleton */}
      <div className="h-16 bg-muted/60 rounded-xl" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-muted/60 rounded-lg" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="h-10 bg-muted/40 rounded-lg w-2/3" />
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted/40 rounded-xl border border-border/30" />
        ))}
      </div>
    </div>
  );
}
