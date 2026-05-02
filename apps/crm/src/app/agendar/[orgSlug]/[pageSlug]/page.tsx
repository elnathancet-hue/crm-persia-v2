import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicBookingPage } from "@/actions/agenda/public";
import { BookingPagePublicClient } from "./booking-public-client";

interface RouteParams {
  params: Promise<{ orgSlug: string; pageSlug: string }>;
}

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params;
  const resolved = await getPublicBookingPage(orgSlug, pageSlug);
  if (!resolved) {
    return { title: "Página não encontrada" };
  }
  return {
    title: `${resolved.page.title} — ${resolved.organization.name}`,
    description: resolved.page.description ?? undefined,
  };
}

export default async function PublicBookingPage({ params }: RouteParams) {
  const { orgSlug, pageSlug } = await params;
  const resolved = await getPublicBookingPage(orgSlug, pageSlug);

  if (!resolved) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <BookingPagePublicClient resolved={resolved} />
      </div>
    </main>
  );
}
