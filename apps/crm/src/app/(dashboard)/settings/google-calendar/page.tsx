import { GoogleCalendarSettingsClient } from "./google-calendar-client";
import { getGoogleCalendarStatus } from "@/actions/google-calendar";

export const metadata = { title: "Google Agenda — Configurações" };

export default async function GoogleCalendarSettingsPage() {
  const status = await getGoogleCalendarStatus();
  return <GoogleCalendarSettingsClient initialStatus={status} />;
}
