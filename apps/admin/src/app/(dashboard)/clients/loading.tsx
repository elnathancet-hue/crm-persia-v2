export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse p-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-36 bg-muted rounded-lg" />
        <div className="h-9 w-32 bg-muted rounded-xl" />
      </div>
      <div className="h-9 bg-muted rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-muted/30 h-32" />
        ))}
      </div>
    </div>
  );
}
