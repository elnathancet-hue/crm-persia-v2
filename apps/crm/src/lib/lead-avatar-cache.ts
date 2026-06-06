export const LEAD_AVATARS_BUCKET = "lead-avatars";
export const GROUP_AVATARS_BUCKET = "group-avatars";
const MAX_AVATAR_BYTES = 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function isStorageUrl(url: string): boolean {
  return url.includes(`/storage/v1/object/public/${LEAD_AVATARS_BUCKET}/`);
}

function isGroupStorageUrl(url: string): boolean {
  return url.includes(`/storage/v1/object/public/${GROUP_AVATARS_BUCKET}/`);
}

function extensionForMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? "jpg";
}

export function isCachedLeadAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && isStorageUrl(url);
}

export function isCachedGroupAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && isGroupStorageUrl(url);
}

export async function cacheLeadAvatarFromUrl(input: {
  organizationId: string;
  leadId: string;
  remoteUrl: string | null | undefined;
}): Promise<string | null> {
  const remoteUrl = input.remoteUrl?.trim();
  if (!remoteUrl) return null;
  if (isStorageUrl(remoteUrl)) return remoteUrl;

  const response = await fetch(remoteUrl, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "user-agent":
        "Mozilla/5.0 (compatible; PersiaCRM/1.0; +https://persiacrm.com)",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar avatar WhatsApp: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Avatar WhatsApp retornou content-type invalido: ${mimeType}`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Avatar WhatsApp veio vazio");
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("Avatar WhatsApp excede 1MB");
  }

  const ext = extensionForMime(mimeType);
  const storagePath = `${input.organizationId}/${input.leadId}.${ext}`;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(LEAD_AVATARS_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "86400",
    });

  if (error) {
    throw new Error(`Falha ao salvar avatar no Storage: ${error.message}`);
  }

  const { data } = admin.storage
    .from(LEAD_AVATARS_BUCKET)
    .getPublicUrl(storagePath);

  return data.publicUrl;
}

async function cacheRemoteAvatarToPublicBucket(input: {
  bucket: string;
  storagePath: string;
  remoteUrl: string;
}): Promise<string | null> {
  const response = await fetch(input.remoteUrl, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "user-agent":
        "Mozilla/5.0 (compatible; PersiaCRM/1.0; +https://persiacrm.com)",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return null;

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  if (!mimeType.startsWith("image/")) return null;

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) return null;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(input.bucket)
    .upload(input.storagePath, bytes, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "86400",
    });

  if (error) return null;

  const { data } = admin.storage.from(input.bucket).getPublicUrl(input.storagePath);
  return data.publicUrl;
}

export async function cacheGroupMemberAvatarFromUrl(input: {
  organizationId: string;
  membershipId: string;
  remoteUrl: string | null | undefined;
  currentAvatarUrl?: string | null;
}): Promise<string | null> {
  const remoteUrl = input.remoteUrl?.trim();
  if (!remoteUrl) return isGroupStorageUrl(input.currentAvatarUrl ?? "") ? input.currentAvatarUrl! : null;
  if (isGroupStorageUrl(remoteUrl)) return remoteUrl;
  if (input.currentAvatarUrl && isGroupStorageUrl(input.currentAvatarUrl)) {
    return input.currentAvatarUrl;
  }

  const ext = (() => {
    try {
      const fromPath = new URL(remoteUrl).pathname.split(".").pop()?.toLowerCase();
      return fromPath && /^[a-z0-9]{2,5}$/.test(fromPath) ? fromPath : "jpg";
    } catch {
      return "jpg";
    }
  })();

  return await cacheRemoteAvatarToPublicBucket({
    bucket: GROUP_AVATARS_BUCKET,
    storagePath: `${input.organizationId}/members/${input.membershipId}.${ext}`,
    remoteUrl,
  });
}

// ── getAndCacheContactAvatar ───────────────────────────────────────────────────
// Serviço único (Etapa 1 do roadmap). Centraliza a lógica de:
// 1. skip se já há URL cacheada (a menos que force: true)
// 2. buscar foto via provider.getContactProfilePic(phone)
// 3. cachear no Storage via cacheLeadAvatarFromUrl
// 4. atualizar leads.avatar_url se leadId foi fornecido e URL mudou
// 5. retornar sem lançar erro em qualquer falha de rede/UAZAPI
export async function getAndCacheContactAvatar(input: {
  organizationId: string;
  leadId?: string | null;
  groupMembershipId?: string | null;
  phone: string;
  currentAvatarUrl?: string | null;
  /** Provider WhatsApp para chamada getContactProfilePic */
  provider: {
    getContactProfilePic(phone: string): Promise<string | null>;
    getChatImageUrl?(chatId: string, opts?: { preview?: boolean }): Promise<string | null>;
  };
  force?: boolean;
}): Promise<{ avatarUrl: string | null; updated: boolean }> {
  const { organizationId, leadId, groupMembershipId, phone, currentAvatarUrl, provider, force } = input;

  // Skip se já temos URL cacheada e não está forçando refresh
  if (!force && currentAvatarUrl && (isCachedLeadAvatarUrl(currentAvatarUrl) || isCachedGroupAvatarUrl(currentAvatarUrl))) {
    return { avatarUrl: currentAvatarUrl, updated: false };
  }

  try {
    const remoteUrl =
      (provider.getChatImageUrl
        ? await provider.getChatImageUrl(phone, { preview: true })
        : null) ??
      (await provider.getContactProfilePic(phone));
    if (!remoteUrl) {
      return { avatarUrl: currentAvatarUrl ?? null, updated: false };
    }

    // Se a URL remota já é a mesma que temos, não recachear
    if (!force && currentAvatarUrl && remoteUrl === currentAvatarUrl) {
      return { avatarUrl: currentAvatarUrl, updated: false };
    }

    if (!leadId && groupMembershipId) {
      const cachedMemberUrl = await cacheGroupMemberAvatarFromUrl({
        organizationId,
        membershipId: groupMembershipId,
        remoteUrl,
        currentAvatarUrl,
      });
      return {
        avatarUrl: cachedMemberUrl ?? currentAvatarUrl ?? null,
        updated: Boolean(cachedMemberUrl && cachedMemberUrl !== currentAvatarUrl),
      };
    }

    if (!leadId) {
      return { avatarUrl: currentAvatarUrl ?? null, updated: false };
    }

    const cachedUrl = await cacheLeadAvatarFromUrl({
      organizationId,
      leadId,
      remoteUrl,
    });

    if (!cachedUrl) return { avatarUrl: currentAvatarUrl ?? null, updated: false };

    // Atualiza leads.avatar_url se URL mudou
    if (cachedUrl !== currentAvatarUrl) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin.from("leads").update({ avatar_url: cachedUrl }).eq("id", leadId);
      return { avatarUrl: cachedUrl, updated: true };
    }

    return { avatarUrl: cachedUrl, updated: false };
  } catch {
    // Best-effort: falha de rede, rate limit, foto privada → retorna o que tinha
    return { avatarUrl: currentAvatarUrl ?? null, updated: false };
  }
}

// ── cacheGroupAvatarFromUrl ────────────────────────────────────────────────────
// Etapa 5: análogo a cacheLeadAvatarFromUrl mas para grupos.
// Bucket: group-avatars / {orgId}/{groupId}.{ext}
// Atualiza whatsapp_groups.image_url + image_fetched_at.
export async function cacheGroupAvatarFromUrl(input: {
  organizationId: string;
  groupId: string;
  remoteUrl: string | null | undefined;
  currentImageUrl?: string | null;
}): Promise<string | null> {
  const remoteUrl = input.remoteUrl?.trim();
  if (!remoteUrl) return input.currentImageUrl ?? null;

  if (isGroupStorageUrl(remoteUrl)) return remoteUrl;
  // Se já temos URL cacheada e não mudou, skip
  if (input.currentImageUrl && isGroupStorageUrl(input.currentImageUrl)) {
    return input.currentImageUrl;
  }

  try {
    const response = await fetch(remoteUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; PersiaCRM/1.0; +https://persiacrm.com)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return input.currentImageUrl ?? null;

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!mimeType.startsWith("image/")) return input.currentImageUrl ?? null;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) return input.currentImageUrl ?? null;

    const ext = MIME_TO_EXT[mimeType.toLowerCase()] ?? "jpg";
    const storagePath = `${input.organizationId}/${input.groupId}.${ext}`;
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();

    const { error } = await admin.storage
      .from(GROUP_AVATARS_BUCKET)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: true, cacheControl: "86400" });

    if (error) return input.currentImageUrl ?? null;

    const { data } = admin.storage.from(GROUP_AVATARS_BUCKET).getPublicUrl(storagePath);
    const publicUrl = data.publicUrl;

    // Persistir no DB (colunas adicionadas em migration 086, ainda fora dos tipos gerados)
    await (admin.from("whatsapp_groups") as any)
      .update({ image_url: publicUrl, image_fetched_at: new Date().toISOString() })
      .eq("id", input.groupId)
      .select("group_jid")
      .single()
      .then(async ({ data: g }: any) => {
        if (g?.group_jid) {
          await admin.from("leads")
            .update({ avatar_url: publicUrl })
            .eq("phone", g.group_jid)
            .eq("organization_id", input.organizationId);
        }
      });

    return publicUrl;
  } catch {
    return input.currentImageUrl ?? null;
  }
}
