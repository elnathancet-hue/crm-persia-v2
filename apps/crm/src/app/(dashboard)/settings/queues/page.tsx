import { getQueues } from "@/actions/queues";
import { QueuesPageClient } from "./queues-client";

export default async function QueuesPage() {
  const queues = await getQueues();

  return <QueuesPageClient initialQueues={queues || []} />;
}
