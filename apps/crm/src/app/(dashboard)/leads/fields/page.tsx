import { getCustomFields } from "@/actions/custom-fields";
import { CustomFieldsClient } from "./custom-fields-client";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function CustomFieldsPage() {
  await requireAdminPageAccess();
  const fields = await getCustomFields();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-heading">Campos Personalizados</h1>
        <p className="text-sm text-muted-foreground">
          Adicione campos extras aos seus leads para capturar dados especificos
        </p>
      </div>
      <CustomFieldsClient initialFields={(fields || []) as never} />
    </div>
  );
}
