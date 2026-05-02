import { CalendarOff } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4">
      <div className="max-w-md rounded-3xl bg-white p-8 text-center ring-1 ring-slate-200 shadow-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <CalendarOff size={26} />
        </div>
        <h1 className="mt-4 text-xl font-black text-slate-900">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          A página de agendamento que você está procurando não existe ou está
          desativada.
        </p>
        <p className="mt-3 text-[11px] text-slate-400">
          Confirme o link com quem te enviou.
        </p>
      </div>
    </main>
  );
}
