// PR-AUDIT (mai/2026): brand panel agora forca contexto `.dark` —
// sempre renderiza com tokens do dark theme (navy + gold) independente
// do tema escolhido pelo usuario. Isso significa que a IDENTIDADE
// "Persia Navy + Gold" e consistente em login/register/forgot, e os
// hex hardcoded (#090B1A, #C9A84C, #1B1E4B) viram referencias ao
// design system. Resultado: trocar a marca/tema dark = trocar o panel
// automaticamente.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      {/* Right: Brand panel — sempre dark (Persia Navy + Gold) */}
      <div
        className="dark hidden lg:flex lg:w-[480px] items-center justify-center p-12 relative overflow-hidden bg-gradient-to-br from-background to-secondary"
      >
        {/* Decorative gold diamond — usa currentColor + text-primary
            pra herdar o gold do dark theme (--primary = hsl(43, 54%, 54%)) */}
        <div className="absolute top-8 right-8 opacity-10 text-primary">
          <svg width="120" height="120" viewBox="0 0 40 40" fill="none">
            <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1" />
            <circle cx="20" cy="20" r="3" fill="currentColor" />
          </svg>
        </div>

        <div className="text-foreground space-y-6 max-w-sm relative z-10">
          {/* Logo mark — primary/12 bg + primary/25 border + primary stroke */}
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-primary/10 ring-1 ring-primary/25 text-primary">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.5" />
              <circle cx="20" cy="20" r="3" fill="currentColor" />
            </svg>
          </div>
          {/* Wordmark — "Pérsia" foreground + "CRM" primary */}
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tracking-tight font-heading text-foreground">Pérsia</span>
            <span className="text-xl font-bold tracking-tight font-heading text-primary">CRM</span>
          </div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
            Automatize seu atendimento com IA em 5 minutos
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            PérsiaCRM conecta seu WhatsApp a uma IA que atende, qualifica e converte leads automaticamente. Sem setup complexo, sem tutoriais.
          </p>
          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading text-primary">5 min</p>
              <p className="text-xs text-muted-foreground">Setup completo</p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading text-primary">0</p>
              <p className="text-xs text-muted-foreground">Tutoriais</p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading text-primary">24/7</p>
              <p className="text-xs text-muted-foreground">IA ativa</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
