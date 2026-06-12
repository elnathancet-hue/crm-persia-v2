export const metadata = { title: "Grupos" };
import { getGroups } from "@/actions/groups";
import { GroupsClient } from "./groups-client";
import { requireService } from "@/lib/auth-service";

export default async function GroupsPage() {
  await requireService("groups");
  const groups = await getGroups();
  return <GroupsClient initialGroups={groups as never} />;
}
