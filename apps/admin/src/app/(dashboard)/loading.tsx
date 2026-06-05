export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse p-6">
      <div className="h-8 w-64 bg-muted rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-muted/30 h-28" />
        ))}
      </div>
      <div className="h-6 w-40 bg-muted rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-muted/30 h-20" />
        ))}
      </div>
    </div>
  );
}
