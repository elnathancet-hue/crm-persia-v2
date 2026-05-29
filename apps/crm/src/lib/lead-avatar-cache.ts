const LEAD_AVATARS_BUCKET = "lead-avatars";
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

function extensionForMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? "jpg";
}

export function isCachedLeadAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && isStorageUrl(url);
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
