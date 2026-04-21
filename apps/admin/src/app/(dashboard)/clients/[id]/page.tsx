"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getOrganizationDetail } from "@/actions/admin";
import { ClientDetail } from "./client-detail";

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrganizationDetail(id).then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!data) return <p className="text-muted-foreground">Cliente não encontrado</p>;

  return <ClientDetail data={data} />;
}
