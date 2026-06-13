import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { notFound } from "next/navigation";
import { CreditCard, Calendar, Package } from "lucide-react";

export const metadata = { title: "Plano — Configurações" };

const planLabels: Record<string, string> = {
  trial: "Avaliação",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
  custom: "Personalizado",
};

const planColors: Record<string, string> = {
  trial: "text-muted-foreground bg-muted",
  starter: "text-primary bg-primary/10",
  pro: "text-success bg-success/10",
  enterprise: "text-warning bg-warning/10",
  custom: "text-progress bg-progress/10",
};

export default async function BillingPage() {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  let ctx: Awaited<ReturnType<typeof requireSuperadminForOrg>>;
  try {
    ctx = await requireSuperadminForOrg();
  } catch {
    notFound();
  }
  const { admin, orgId } = ctx;

  const { data: org } = await admin
    .from("organizations")
    .select("name, plan, category, created_at, updated_at")
    .eq("id", orgId)
    .single();

  if (!org) return <div className="text-sm text-muted-foreground">Organização não encontrada.</div>;

  const plan = (org as { plan?: string }).plan ?? "trial";
  const createdAt = (org as { created_at?: string }).created_at;
  const colorClass = planColors[plan] ?? planColors["trial"];

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-foreground">Plano e Cobrança</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Informações do plano da organização gerenciada.
        </p>
      </div>

      <div className="border border-border rounded-xl bg-card divide-y divide-border">
        <div className="flex items-center gap-4 p-4">
          <div className="size-10 rounded-xl flex items-center justify-center bg-primary/10">
            <Package className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Plano atual</p>
            <p className="font-semibold text-foreground mt-0.5">
              {planLabels[plan] ?? plan}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${colorClass}`}>
            {planLabels[plan] ?? plan}
          </span>
        </div>

        {(org as { category?: string }).category && (
          <div className="flex items-center gap-4 p-4">
            <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
              <CreditCard className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Segmento</p>
              <p className="font-medium text-foreground mt-0.5 capitalize">
                {(org as { category?: string }).category}
              </p>
            </div>
          </div>
        )}

        {createdAt && (
          <div className="flex items-center gap-4 p-4">
            <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
              <Calendar className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Cliente desde</p>
              <p className="font-medium text-foreground mt-0.5">
                {new Date(createdAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Para alterar o plano, edite diretamente na página do cliente em{" "}
        <span className="font-medium text-foreground">/clients/{orgId}</span>.
      </p>
    </div>
  );
}
