import { getQueues } from "@/actions/queues";
import { QueuesPageClient } from "./queues-client";

export const metadata = { title: "Filas — Configurações" };

export default async function QueuesPage() {
  const queues = await getQueues();

  return <QueuesPageClient initialQueues={queues || []} />;
}
