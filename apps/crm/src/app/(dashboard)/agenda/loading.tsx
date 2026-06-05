export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-28 bg-muted rounded-lg" />
        <div className="h-9 w-32 bg-muted rounded-xl" />
      </div>
      <div className="rounded-xl border bg-muted/20 h-[calc(100vh-180px)]" />
    </div>
  );
}
