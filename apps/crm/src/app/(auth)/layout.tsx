export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      {/* Right: Brand panel — PérsiaCRM navy + gold */}
      <div
        className="hidden lg:flex lg:w-[480px] items-center justify-center p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #090B1A 0%, #1B1E4B 100%)' }}
      >
        {/* Decorative gold diamond in background */}
        <div className="absolute top-8 right-8 opacity-10">
          <svg width="120" height="120" viewBox="0 0 40 40" fill="none">
            <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="#C9A84C" strokeWidth="1"/>
            <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="#C9A84C" strokeWidth="1"/>
            <circle cx="20" cy="20" r="3" fill="#C9A84C"/>
          </svg>
        </div>

        <div className="text-white space-y-6 max-w-sm relative z-10">
          {/* Logo mark */}
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(201, 168, 76, 0.12)', border: '1px solid rgba(201, 168, 76, 0.25)' }}>
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="#C9A84C" strokeWidth="1.8"/>
              <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="#C9A84C" strokeWidth="1.8" opacity="0.5"/>
              <circle cx="20" cy="20" r="3" fill="#C9A84C"/>
            </svg>
          </div>
          {/* Wordmark */}
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tracking-tight font-heading text-white">Pérsia</span>
            <span className="text-xl font-bold tracking-tight font-heading" style={{ color: '#C9A84C' }}>CRM</span>
          </div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Automatize seu atendimento com IA em 5 minutos
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">
            PérsiaCRM conecta seu WhatsApp a uma IA que atende, qualifica e converte leads automaticamente. Sem setup complexo, sem tutoriais.
          </p>
          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading" style={{ color: '#C9A84C' }}>5 min</p>
              <p className="text-xs text-white/50">Setup completo</p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading" style={{ color: '#C9A84C' }}>0</p>
              <p className="text-xs text-white/50">Tutoriais</p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight font-heading" style={{ color: '#C9A84C' }}>24/7</p>
              <p className="text-xs text-white/50">IA ativa</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
