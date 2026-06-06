import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { GroupDetailClient } from "./group-detail-client";

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // .single() falha com PGRST116 pra users com 2+ memberships, o que
  // disparava redirect /login. Pega o mais antigo (padrao dashboard).
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) redirect("/login");

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select(
      "id, group_jid, name, description, invite_link, participant_count, is_announce, is_locked, category, image_url",
    )
    .eq("id", id)
    .eq("organization_id", member.organization_id)
    .single();

  if (!group) redirect("/groups");

  // Get leads for invite selector
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", member.organization_id)
    .not("phone", "is", null)
    .order("name")
    .limit(200);

  // Initial group messages (last 50).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: messages } = await (supabase as any)
    .from("group_messages")
    .select(
      "id, direction, text, sender_name, sender_jid, sender_phone, sender_lead_id, sender_membership_id, sender_identity_kind, sender_avatar_url, media_type, media_url, whatsapp_msg_id, reply_to_whatsapp_msg_id, created_at",
    )
    .eq("organization_id", member.organization_id)
    .eq("group_id", id)
    .order("created_at", { ascending: true })
    .limit(50);

  // Resolve chat-media: refs to signed URLs before passing as props.
  const resolvedMessages = await Promise.all(
    (messages || []).map(async (msg: Record<string, unknown>) => {
      const mediaUrl = msg.media_url as string | null;
      if (!mediaUrl?.startsWith("chat-media:")) return msg;
      const path = mediaUrl.slice("chat-media:".length).replace(/^\/+/, "");
      const { data } = await supabase.storage.from("chat-media").createSignedUrl(path, 3600);
      return data?.signedUrl ? { ...msg, media_url: data.signedUrl } : msg;
    }),
  );

  return (
    <GroupDetailClient
      group={group as never}
      leads={(leads || []) as never}
      initialMessages={(resolvedMessages || []) as never}
    />
  );
}
