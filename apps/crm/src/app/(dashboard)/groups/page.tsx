export const metadata = { title: "Grupos" };
import { getGroups } from "@/actions/groups";
import { GroupsClient } from "./groups-client";

export default async function GroupsPage() {
  const groups = await getGroups();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Grupos WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie seus grupos e envie convites para leads
        </p>
      </div>
      <GroupsClient initialGroups={groups as never} />
    </div>
  );
}
