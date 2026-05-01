// Re-export central das server actions da Agenda. Permite imports
// simples a partir das rotas/components:
//
//   import { getAppointments, createAppointment } from "@/actions/agenda";

export * from "./appointments";
export * from "./services";
export * from "./availability";
export * from "./booking-pages";
