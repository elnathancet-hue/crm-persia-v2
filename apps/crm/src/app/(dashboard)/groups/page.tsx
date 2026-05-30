export const metadata = { title: "Grupos" };
import { getGroups } from "@/actions/groups";
import { GroupsClient } from "./groups-client";

export default async function GroupsPage() {
  const groups = await getGroups();
  return <GroupsClient initialGroups={groups as never} />;
}
