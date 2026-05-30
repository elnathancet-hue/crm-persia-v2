import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveSmartLink } from "@/actions/groups";
import { SmartLinkClient } from "./smart-link-client";

interface RouteParams {
  params: Promise<{ orgSlug: string; campaignSlug: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { orgSlug, campaignSlug } = await params;
  const resolution = await resolveSmartLink(orgSlug, campaignSlug);
  if (!resolution) return { title: "Grupo não encontrado" };
  return {
    title: `${resolution.campaign.name} — ${resolution.organization.name}`,
    description: resolution.campaign.description ?? "Clique para entrar no grupo do WhatsApp.",
  };
}

export default async function SmartLinkPage({ params, searchParams }: RouteParams) {
  const { orgSlug, campaignSlug } = await params;
  const utms = await searchParams;

  const resolution = await resolveSmartLink(orgSlug, campaignSlug);
  if (!resolution) notFound();

  return (
    <SmartLinkClient
      resolution={resolution}
      orgSlug={orgSlug}
      campaignSlug={campaignSlug}
      utms={utms}
    />
  );
}
