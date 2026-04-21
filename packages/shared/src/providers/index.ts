import type { WhatsAppConnection, WhatsAppProvider } from "../whatsapp";
import { MetaCloudAdapter } from "./meta-cloud";
import { UazapiAdapter } from "./uazapi";

/**
 * Resolves a WhatsAppProvider implementation from a stored connection.
 *
 * Routes on `connection.provider`:
 *   - "uazapi" (default)  → UazapiAdapter     (instance_url + instance_token)
 *   - "meta_cloud"        → MetaCloudAdapter  (phone_number_id + waba_id + access_token)
 *
 * The connection object must carry the credentials the chosen provider needs.
 */
export function createProvider(connection: WhatsAppConnection): WhatsAppProvider {
  const kind = connection.provider ?? "uazapi";

  switch (kind) {
    case "uazapi": {
      if (!connection.instance_url || !connection.instance_token) {
        throw new Error("UAZAPI provider requires instance_url and instance_token");
      }
      return new UazapiAdapter(connection.instance_url, connection.instance_token);
    }
    case "meta_cloud": {
      if (!connection.phone_number_id || !connection.waba_id || !connection.access_token) {
        throw new Error("Meta Cloud provider requires phone_number_id, waba_id and access_token");
      }
      return new MetaCloudAdapter({
        phoneNumberId: connection.phone_number_id,
        wabaId: connection.waba_id,
        accessToken: connection.access_token,
        verifyToken: connection.webhook_verify_token ?? "",
      });
    }
    default: {
      throw new Error(`Unknown WhatsApp provider: ${kind}`);
    }
  }
}

export { MetaCloudAdapter } from "./meta-cloud";
export { UazapiAdapter } from "./uazapi";
