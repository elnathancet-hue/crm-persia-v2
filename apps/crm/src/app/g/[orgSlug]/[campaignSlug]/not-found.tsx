export default function SmartLinkNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
      <p className="text-4xl mb-4">😕</p>
      <h1 className="text-xl font-semibold">Link não encontrado</h1>
      <p className="text-muted-foreground text-sm mt-2">
        Este link de grupo não existe ou foi desativado.
      </p>
    </div>
  );
}
