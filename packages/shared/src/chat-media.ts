export const CHAT_MEDIA_BUCKET = "chat-media";
export const CHAT_MEDIA_REF_PREFIX = "chat-media:";
export const CHAT_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const CHAT_MEDIA_PROVIDER_URL_TTL_SECONDS = 15 * 60;

export function toChatMediaRef(path: string): string {
  return `${CHAT_MEDIA_REF_PREFIX}${path.replace(/^\/+/, "")}`;
}

export function isExternalMediaUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  );
}

export function getChatMediaPath(
  value: string | null | undefined,
  supabaseUrl?: string,
): string | null {
  if (!value) return null;

  if (value.startsWith(CHAT_MEDIA_REF_PREFIX)) {
    return decodeURIComponent(value.slice(CHAT_MEDIA_REF_PREFIX.length).replace(/^\/+/, ""));
  }

  const publicMarker = `/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`;
  const signedMarker = `/storage/v1/object/sign/${CHAT_MEDIA_BUCKET}/`;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      const normalizedSupabaseUrl = supabaseUrl?.replace(/\/$/, "");
      const normalizedOrigin = `${url.protocol}//${url.host}`;

      if (normalizedSupabaseUrl && !normalizedSupabaseUrl.startsWith(normalizedOrigin)) {
        return null;
      }

      const marker = url.pathname.includes(publicMarker) ? publicMarker : signedMarker;
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex === -1) return null;

      return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    } catch {
      return null;
    }
  }

  if (value.includes("/") && !value.includes("://")) {
    return decodeURIComponent(value.replace(/^\/+/, ""));
  }

  return null;
}

export function needsChatMediaSigning(
  value: string | null | undefined,
  supabaseUrl?: string,
): boolean {
  return getChatMediaPath(value, supabaseUrl) !== null;
}
