import { GoogleCalendarSettingsClient } from "./google-calendar-client";
import { getGoogleCalendarStatus } from "@/actions/google-calendar";

export default async function GoogleCalendarSettingsPage() {
  const status = await getGoogleCalendarStatus();
  return <GoogleCalendarSettingsClient initialStatus={status} />;
}
