export default function Loading() {
  return (
    <div className="flex h-full animate-pulse -m-6">
      {/* groups list */}
      <div className="w-80 border-r flex flex-col gap-1 p-3 shrink-0">
        <div className="h-9 bg-muted rounded-xl mb-2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3 p-2 rounded-xl">
            <div className="size-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-3.5 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted/60 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 bg-muted/10" />
    </div>
  );
}
