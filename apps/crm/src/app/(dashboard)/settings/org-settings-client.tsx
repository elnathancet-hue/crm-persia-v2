"use client";

import * as React from "react";
import { Save, Loader2, Camera, Eye, EyeOff, Lock, User as UserIcon, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { updateOrgSettings } from "@/actions/organization";
import { updateUserProfile, changeUserPassword, uploadUserAvatar } from "@/actions/profile";
import { toast } from "sonner";

export function OrgSettingsClient({
  orgId: _orgId,
  initialName,
  initialNiche,
  initialWebsite,
  plan,
  userEmail,
  userFullName,
  userPhone,
  userAvatarUrl,
}: {
  orgId: string;
  initialName: string;
  initialNiche: string;
  initialWebsite: string;
  plan: string;
  userEmail: string;
  userFullName: string;
  userPhone: string;
  userAvatarUrl: string;
}) {
  const [fullName, setFullName] = React.useState(userFullName);
  const [phone, setPhone] = React.useState(userPhone);
  const [avatarUrl, setAvatarUrl] = React.useState(userAvatarUrl);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [savingPw, setSavingPw] = React.useState(false);

  const [orgName, setOrgName] = React.useState(initialName);
  const [niche, setNiche] = React.useState(initialNiche);
  const [website, setWebsite] = React.useState(initialWebsite);
  const [savingOrg, setSavingOrg] = React.useState(false);

  const initials =
    fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?";

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = await uploadUserAvatar(fd);
      setAvatarUrl(url);
      toast.success("Foto atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar foto");
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  }

  async function handleSaveProfile() {
    if (!fullName.trim()) { toast.error("Nome obrigat\u00f3rio"); return; }
    setSavingProfile(true);
    try {
      await updateUserProfile({ full_name: fullName, phone });
      toast.success("Perfil salvo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) { toast.error("Senha deve ter no m\u00ednimo 8 caracteres"); return; }
    if (newPassword !== confirmPassword) { toast.error("Senhas n\u00e3o conferem"); return; }
    setSavingPw(true);
    try {
      await changeUserPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Senha alterada com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar senha");
    } finally {
      setSavingPw(false);
    }
  }

  async function handleSaveOrg() {
    if (!orgName.trim()) { toast.error("Nome da empresa obrigat\u00f3rio"); return; }
    setSavingOrg(true);
    try {
      await updateOrgSettings({ _org_name: orgName, _org_niche: niche, _org_website: website });
      toast.success("Organiza\u00e7\u00e3o salva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingOrg(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Perfil */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserIcon className="size-4" />
            Seu perfil
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="size-16">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              {avatarUploading && (
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                  <Loader2 className="size-4 text-white animate-spin" />
                </div>
              )}
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={avatarUploading}>
                <Camera className="size-4" />
                {avatarUploading ? "Enviando..." : "Alterar foto"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG ou WebP — m\u00e1x 2 MB</p>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarFile} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Nome completo</Label>
              <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" value={userEmail} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">Para alterar o e-mail entre em contato com o suporte.</p>
            </div>
          </div>

          <Button onClick={handleSaveProfile} disabled={savingProfile} size="sm">
            {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {savingProfile ? "Salvando..." : "Salvar perfil"}
          </Button>
        </CardContent>
      </Card>

      {/* Senha */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="size-4" />
            Alterar senha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new_password">Nova senha</Label>
              <div className="relative">
                <Input id="new_password" type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="M\u00ednimo 8 caracteres" />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_password">Confirmar nova senha</Label>
              <Input id="confirm_password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repita a nova senha" />
            </div>
          </div>
          <Button onClick={handleChangePassword} disabled={savingPw || !newPassword} size="sm" variant="outline">
            {savingPw ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {savingPw ? "Alterando..." : "Alterar senha"}
          </Button>
        </CardContent>
      </Card>

      {/* Organização */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="size-4" />
              Organização
            </CardTitle>
            <Badge>{plan}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org_name">Nome da empresa *</Label>
              <Input id="org_name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="niche">Nicho</Label>
              <Input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Ex: Estética, Educação..." />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <Button onClick={handleSaveOrg} disabled={savingOrg} size="sm">
            {savingOrg ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {savingOrg ? "Salvando..." : "Salvar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
