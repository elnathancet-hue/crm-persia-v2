import { CalendarOff } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4">
      <div className="max-w-md rounded-3xl bg-card p-8 text-center ring-1 ring-border shadow-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground/70">
          <CalendarOff size={26} />
        </div>
        <h1 className="mt-4 text-xl font-black text-foreground">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A página de agendamento que você está procurando não existe ou está
          desativada.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground/70">
          Confirme o link com quem te enviou.
        </p>
      </div>
    </main>
  );
}
