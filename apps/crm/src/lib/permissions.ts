// Sistema de permissões JSONB por módulo.
// Fonte de verdade para presets, tipos e helpers de verificação.

export interface OrgPermissions {
  agenda:      { read: boolean; write: boolean; delete: boolean };
  crm:         { read: boolean; write: boolean; delete: boolean };
  chat:        { read: boolean; write: boolean; own_only: boolean };
  leads:       { read: boolean; write: boolean; delete: boolean; own_only: boolean };
  groups:      { read: boolean; write: boolean };
  campaigns:   { read: boolean; write: boolean };
  automations: { read: boolean; write: boolean };
  reports:     { read: boolean; team: boolean };
  settings:    { read: boolean; write: boolean };
}

export type PermissionModule = keyof OrgPermissions;
export type PermissionAction = "read" | "write" | "delete" | "own_only" | "team";

// ---------------------------------------------------------------------------
// Presets dos 5 cards de função
// ---------------------------------------------------------------------------

export const PERMISSION_PRESETS = {

  agendador: {
    agenda:      { read: true,  write: true,  delete: false },
    crm:         { read: false, write: false, delete: false },
    chat:        { read: false, write: false, own_only: true },
    leads:       { read: true,  write: false, delete: false, own_only: false },
    groups:      { read: false, write: false },
    campaigns:   { read: false, write: false },
    automations: { read: false, write: false },
    reports:     { read: false, team: false },
    settings:    { read: false, write: false },
  },

  usuario: {
    agenda:      { read: true,  write: true,  delete: false },
    crm:         { read: false, write: false, delete: false },
    chat:        { read: true,  write: true,  own_only: true },
    leads:       { read: false, write: false, delete: false, own_only: true },
    groups:      { read: false, write: false },
    campaigns:   { read: false, write: false },
    automations: { read: false, write: false },
    reports:     { read: true,  team: false },
    settings:    { read: false, write: false },
  },

  usuario_leads: {
    agenda:      { read: true,  write: true,  delete: false },
    crm:         { read: true,  write: true,  delete: false },
    chat:        { read: true,  write: true,  own_only: true },
    leads:       { read: true,  write: true,  delete: false, own_only: true },
    groups:      { read: false, write: false },
    campaigns:   { read: false, write: false },
    automations: { read: false, write: false },
    reports:     { read: true,  team: false },
    settings:    { read: false, write: false },
  },

  gestor: {
    agenda:      { read: true, write: true,  delete: true  },
    crm:         { read: true, write: true,  delete: false },
    chat:        { read: true, write: true,  own_only: false },
    leads:       { read: true, write: true,  delete: false, own_only: false },
    groups:      { read: true, write: true  },
    campaigns:   { read: true, write: true  },
    automations: { read: true, write: false },
    reports:     { read: true, team: true   },
    settings:    { read: false, write: false },
  },

  admin: {
    agenda:      { read: true, write: true, delete: true },
    crm:         { read: true, write: true, delete: true },
    chat:        { read: true, write: true, own_only: false },
    leads:       { read: true, write: true, delete: true, own_only: false },
    groups:      { read: true, write: true },
    campaigns:   { read: true, write: true },
    automations: { read: true, write: true },
    reports:     { read: true, team: true  },
    settings:    { read: true, write: true },
  },

} satisfies Record<string, OrgPermissions>;

export type PresetKey = keyof typeof PERMISSION_PRESETS;

// DEFAULT para membros existentes = admin (zero regressão)
export const FULL_PERMISSIONS: OrgPermissions = PERMISSION_PRESETS.admin;

export const PRESET_LABELS: Record<PresetKey, string> = {
  agendador:     "Agendador",
  usuario:       "Usuário",
  usuario_leads: "Usuário + Leads",
  gestor:        "Gestor",
  admin:         "Admin",
};

export const PRESET_DESCRIPTIONS: Record<PresetKey, string> = {
  agendador:     "Somente agenda. Sem acesso a chat ou CRM.",
  usuario:       "Acesso às próprias conversas e agenda.",
  usuario_leads: "Próprias conversas, agenda e base de leads.",
  gestor:        "Acesso a todas as conversas e módulos (exceto Config).",
  admin:         "Acesso completo, incluindo configurações.",
};

// org_role mapeado para o preset (para compatibilidade com requireRole)
export const PRESET_ROLE: Record<PresetKey, "admin" | "agent"> = {
  agendador:     "agent",
  usuario:       "agent",
  usuario_leads: "agent",
  gestor:        "admin",
  admin:         "admin",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifica se o objeto de permissões concede acesso a uma ação em um módulo.
 * Seguro contra null/undefined — retorna false se permissions for inválido.
 */
export function hasPermission(
  permissions: OrgPermissions | null | undefined,
  module: PermissionModule,
  action: PermissionAction = "read",
): boolean {
  if (!permissions) return false;
  const mod = permissions[module] as Record<string, boolean> | undefined;
  if (!mod) return false;
  return mod[action] === true;
}

/**
 * Detecta qual preset corresponde a um objeto de permissões.
 * Retorna null se não houver match exato (permissões customizadas).
 */
export function detectPreset(permissions: OrgPermissions): PresetKey | null {
  for (const [key, preset] of Object.entries(PERMISSION_PRESETS)) {
    if (JSON.stringify(preset) === JSON.stringify(permissions)) {
      return key as PresetKey;
    }
  }
  return null;
}
