"use client";

import * as React from "react";
import {
  Users,
  Plus,
  Shield,
  ShieldCheck,
  User,
  Eye,
  Loader2,
  MoreHorizontal,
  Power,
  PowerOff,
} from "lucide-react";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { createTeamMember, updateMemberRole, toggleMemberActive } from "@/actions/team";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  email: string;
  name: string;
}

const ROLE_CONFIG: Record<string, { label: string; description: string; icon: typeof Shield; variant: "default" | "secondary" | "outline" }> = {
  owner: { label: "Dono", description: "Acesso total ao sistema", icon: ShieldCheck, variant: "default" },
  admin: { label: "Admin", description: "Gerencia equipe, configurações e automações", icon: Shield, variant: "default" },
  agent: { label: "Agente", description: "Atende conversas, gerencia leads e filas", icon: User, variant: "secondary" },
  viewer: { label: "Visualizador", description: "Apenas visualiza, sem ação", icon: Eye, variant: "outline" },
};

export function TeamPageClient({ initialMembers }: { initialMembers: TeamMember[] }) {
  const [members, setMembers] = React.useState<TeamMember[]>(initialMembers);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Form
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [role, setRole] = React.useState("agent");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateTeamField(field: string, value: string, rules: { required?: boolean; minLength?: number; email?: boolean }) {
    if (rules.required && !value.trim()) { setError(field, "Campo obrigatório"); return false; }
    if (rules.minLength && value.length < rules.minLength) { setError(field, `Mínimo ${rules.minLength} caracteres`); return false; }
    if (rules.email && value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError(field, "Email inválido"); return false; }
    clearError(field);
    return true;
  }

  function resetForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setConfirmPassword("");
    setRole("agent");
    setErrors({});
  }

  async function handleCreate() {
    let valid = true;
    if (!validateTeamField("team_name", firstName, { required: true })) valid = false;
    if (!validateTeamField("team_email", email, { required: true, email: true })) valid = false;
    if (!validateTeamField("team_password", password, { required: true, minLength: 6 })) valid = false;
    if (password && password !== confirmPassword) {
      setError("team_confirm", "Senhas não conferem");
      valid = false;
    } else {
      clearError("team_confirm");
    }
    if (!valid) return;

    setSaving(true);
    try {
      const result = await createTeamMember({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        role,
      });
      setMembers((prev) => [
        ...prev,
        {
          id: result.id,
          user_id: result.id,
          role,
          is_active: true,
          created_at: new Date().toISOString(),
          email: result.email,
          name: `${firstName} ${lastName}`.trim(),
        },
      ]);
      toast.success("Membro criado com sucesso!");
      setCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      await updateMemberRole(memberId, newRole);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
      toast.success("Funcao atualizada");
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    }
  }

  async function handleToggleActive(memberId: string) {
    try {
      await toggleMemberActive(memberId);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, is_active: !m.is_active } : m)));
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar status");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-end">
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="size-4" />
          Novo Membro
        </Button>
      </div>

      {/* Members Table */}
      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Users className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-base font-semibold">Nenhum membro</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione membros a sua equipe</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{members.length} membros</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Funcao</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const rc = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.agent;
                  const RoleIcon = rc.icon;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <RoleIcon className="size-4 text-muted-foreground" />
                          {member.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{member.email}</TableCell>
                      <TableCell>
                        {member.role === "owner" ? (
                          <Badge variant={rc.variant}>{rc.label}</Badge>
                        ) : (
                          <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v ?? member.role)}>
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="agent">Agente</SelectItem>
                              <SelectItem value="viewer">Visualizador</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.is_active ? "default" : "destructive"}>
                          {member.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(member.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        {member.role !== "owner" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button variant="ghost" size="icon-sm" className="size-7">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleToggleActive(member.id)}>
                                {member.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                                {member.is_active ? "Desativar" : "Ativar"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Member Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Usuário</DialogTitle>
            <DialogDescription>
              O usuário terá acesso ao sistema com as permissões da função selecionada
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  placeholder="Nome"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); clearError("team_name"); }}
                  onBlur={() => validateTeamField("team_name", firstName, { required: true })}
                  className={errors.team_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
                />
                {errors.team_name && <p className="text-xs text-destructive mt-1">{errors.team_name}</p>}
              </div>
              <div className="space-y-2">
                <Label>Sobrenome</Label>
                <Input placeholder="Sobrenome" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>E-mail *</Label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearError("team_email"); }}
                onBlur={() => validateTeamField("team_email", email, { required: true, email: true })}
                className={errors.team_email ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.team_email && <p className="text-xs text-destructive mt-1">{errors.team_email}</p>}
            </div>

            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input placeholder="(00) 00000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Função</Label>
              <Select value={role} onValueChange={(v) => setRole(v ?? "agent")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin - Gerencia equipe e configurações</SelectItem>
                  <SelectItem value="agent">Agente - Atende conversas, gerencia leads</SelectItem>
                  <SelectItem value="viewer">Visualizador - Apenas visualiza</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Senha *</Label>
                <Input
                  type="password"
                  placeholder="Min. 6 caracteres"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError("team_password"); }}
                  onBlur={() => validateTeamField("team_password", password, { required: true, minLength: 6 })}
                  className={errors.team_password ? "border-destructive focus-visible:ring-destructive/50" : ""}
                />
                {errors.team_password && <p className="text-xs text-destructive mt-1">{errors.team_password}</p>}
              </div>
              <div className="space-y-2">
                <Label>Confirmar senha *</Label>
                <Input
                  type="password"
                  placeholder="Repetir senha"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); clearError("team_confirm"); }}
                  onBlur={() => { if (password && confirmPassword && password !== confirmPassword) setError("team_confirm", "Senhas não conferem"); else clearError("team_confirm"); }}
                  className={errors.team_confirm ? "border-destructive focus-visible:ring-destructive/50" : ""}
                />
                {errors.team_confirm && <p className="text-xs text-destructive mt-1">{errors.team_confirm}</p>}
              </div>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {saving ? "Criando..." : "Criar Membro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
