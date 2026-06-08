import { listApiKeys } from "@/actions/api-keys";
import { ApiKeysClient } from "./api-keys-client";

export const metadata = {
  title: "Chaves de API — Configurações",
};

export default async function ApiKeysPage() {
  const keys = await listApiKeys();
  return <ApiKeysClient initialKeys={keys} />;
}
