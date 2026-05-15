"use client";

import * as React from "react";
import { Check, Crown, Zap, Rocket, Building2 } from "lucide-react";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";

interface PlanInfo {
  id: string;
  name: string;
  price: string;
  description: string;
  icon: React.ElementType;
  features: string[];
  highlighted?: boolean;
}

const PLANS: PlanInfo[] = [
  {
    id: "trial",
    name: "Trial",
    price: "Grátis",
    description: "Experimente por 14 dias",
    icon: Zap,
    features: [
      "Até 100 leads",
      "1 usuário",
      "Chat WhatsApp básico",
      "1 pipeline",
      "Relatórios básicos",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: "R$ 97/mês",
    description: "Para pequenos negócios",
    icon: Rocket,
    features: [
      "Até 1.000 leads",
      "3 usuários",
      "Chat WhatsApp completo",
      "3 pipelines",
      "Campanhas WhatsApp",
      "Chatbot IA básico",
      "Relatórios avançados",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "R$ 197/mês",
    description: "Para equipes em crescimento",
    icon: Crown,
    highlighted: true,
    features: [
      "Até 10.000 leads",
      "10 usuários",
      "Chat WhatsApp completo",
      "Pipelines ilimitados",
      "Campanhas WhatsApp e Email",
      "Chatbot IA avançado",
      "Fluxos de automação",
      "Landing pages",
      "Campos personalizados",
      "API e Webhooks",
      "Suporte prioritário",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    price: "R$ 497/mês",
    description: "Para grandes operações",
    icon: Building2,
    features: [
      "Leads ilimitados",
      "Usuários ilimitados",
      "Tudo do Pro",
      "Multi-instância WhatsApp",
      "White label",
      "Integração personalizada",
      "SLA garantido",
      "Gerente de conta dedicado",
    ],
  },
];

export function BillingPageClient({
  currentPlan,
  orgName,
}: {
  currentPlan: string;
  orgName: string;
}) {
  function handleUpgrade(planId: string) {
    window.open(
      `https://wa.me/5586994214060?text=Oi! Quero fazer upgrade para o plano ${planId} do CRM Persia.`,
      "_blank"
    );
  }

  const currentPlanInfo = PLANS.find((p) => p.id === currentPlan);

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plano Atual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                {currentPlanInfo && (
                  <currentPlanInfo.icon className="size-6 text-primary" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">
                    {currentPlanInfo?.name || currentPlan}
                  </h3>
                  <Badge>{currentPlanInfo?.price || currentPlan}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {orgName}
                  {currentPlan === "trial" && " - Período de teste gratuito"}
                </p>
              </div>
            </div>
            {currentPlan === "trial" && (
              <Badge variant="destructive">Expira em breve</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const Icon = plan.icon;

          return (
            <Card
              key={plan.id}
              className={`relative ${
                plan.highlighted
                  ? "border-primary ring-1 ring-primary/20"
                  : ""
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    Mais popular
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <div className="mx-auto h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Icon className="size-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <p className="text-2xl font-bold tracking-tight font-heading">{plan.price}</p>
                <p className="text-xs text-muted-foreground">
                  {plan.description}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Check className="size-4 text-success shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={isCurrent ? "outline" : plan.highlighted ? "default" : "outline"}
                  disabled={isCurrent}
                  onClick={() => handleUpgrade(plan.id)}
                >
                  {isCurrent ? "Plano atual" : "Fazer upgrade"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perguntas Frequentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Posso mudar de plano a qualquer momento?</p>
            <p className="text-muted-foreground">
              Sim, você pode fazer upgrade ou downgrade a qualquer momento.
              O valor será ajustado proporcionalmente.
            </p>
          </div>
          <div>
            <p className="font-medium">Qual a forma de pagamento?</p>
            <p className="text-muted-foreground">
              Aceitamos cartão de crédito, boleto e PIX. O pagamento é mensal
              e pode ser cancelado a qualquer momento.
            </p>
          </div>
          <div>
            <p className="font-medium">O que acontece quando o trial expira?</p>
            <p className="text-muted-foreground">
              Sua conta será limitada até que você escolha um plano. Seus dados
              serão mantidos por 30 dias.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
