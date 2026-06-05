export default function Loading() {
  return (
    <div className="flex gap-4 h-full overflow-hidden animate-pulse pt-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 min-w-[272px]">
          <div className="h-9 bg-muted rounded-xl" />
          {Array.from({ length: i === 0 ? 4 : i === 1 ? 3 : 2 }).map((_, j) => (
            <div key={j} className="h-[88px] bg-muted/60 rounded-xl border border-border/40" />
          ))}
        </div>
      ))}
    </div>
  );
}
