export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 w-28 bg-muted rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-muted/30 h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-muted/30 h-64" />
        <div className="rounded-xl border bg-muted/30 h-64" />
      </div>
    </div>
  );
}
