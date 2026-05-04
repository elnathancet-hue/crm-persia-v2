// Re-export pra preservar compat com imports `@persia/crm-ui`
// adicionados no PR-K6.5. Componente movido pra @persia/ui em PR-K8
// pra ficar disponivel em qualquer pacote.

export {
  DialogHero,
  type DialogHeroProps,
  type DialogHeroTone,
} from "@persia/ui/dialog-hero";
