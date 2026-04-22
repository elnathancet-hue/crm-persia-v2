import "server-only";

import {
  CHAT_MEDIA_BUCKET,
  CHAT_MEDIA_PROVIDER_URL_TTL_SECONDS,
  CHAT_MEDIA_SIGNED_URL_TTL_SECONDS,
  getChatMediaPath,
  toChatMediaRef,
} from "@persia/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;
type MessageWithMedia = { media_url: string | null };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export { CHAT_MEDIA_BUCKET, toChatMediaRef };

export function createChatMediaPath(params: {
  orgId: string;
  conversationId: string;
  fileName: string;
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return `${params.orgId}/${params.conversationId}/${Date.now()}-${safeName}`;
}

export async function ensureChatMediaBucket(admin: AdminClient): Promise<void> {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((bucket) => bucket.name === CHAT_MEDIA_BUCKET)) {
    await admin.storage.createBucket(CHAT_MEDIA_BUCKET, { public: false });
  }
}

export async function resolveChatMediaUrl(
  admin: AdminClient,
  mediaUrl: string | null,
  expiresIn = CHAT_MEDIA_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!mediaUrl) return null;

  const path = getChatMediaPath(mediaUrl, SUPABASE_URL);
  if (!path) return mediaUrl;

  const { data, error } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    console.error("[chat-media] signed URL failed", {
      path,
      error: error?.message ?? "missing signedUrl",
    });
    return mediaUrl;
  }

  return data.signedUrl;
}

export async function resolveProviderChatMediaUrl(
  admin: AdminClient,
  mediaUrl: string,
): Promise<string> {
  return await resolveChatMediaUrl(admin, mediaUrl, CHAT_MEDIA_PROVIDER_URL_TTL_SECONDS) ?? mediaUrl;
}

export async function withSignedChatMediaUrls<T extends MessageWithMedia>(
  admin: AdminClient,
  messages: T[],
): Promise<T[]> {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      media_url: await resolveChatMediaUrl(admin, message.media_url),
    })),
  );
}
