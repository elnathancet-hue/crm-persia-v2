import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <p className="text-6xl font-bold text-muted-foreground/30">404</p>
        <div>
          <p className="font-semibold text-lg">Página não encontrada</p>
          <p className="text-sm text-muted-foreground mt-1">
            O endereço que você acessou não existe ou foi removido.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
