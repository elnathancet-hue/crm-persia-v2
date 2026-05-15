export const metadata = { title: "Grupos" };
import { PageTitle } from "@persia/ui/typography";
import { getGroups } from "@/actions/groups";
import { GroupsClient } from "./groups-client";

export default async function GroupsPage() {
  const groups = await getGroups();

  return (
    <div className="space-y-6">
      <div>
        <PageTitle size="compact">Grupos WhatsApp</PageTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie seus grupos e envie convites para leads
        </p>
      </div>
      <GroupsClient initialGroups={groups as never} />
    </div>
  );
}
