import { PageTitle } from "@persia/ui/typography";
import { getCustomFields } from "@/actions/custom-fields";
import { CustomFieldsClient } from "./custom-fields-client";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function CustomFieldsPage() {
  await requireAdminPageAccess();
  const fields = await getCustomFields();

  return (
    <div className="space-y-6">
      <div>
        <PageTitle size="compact">Campos Personalizados</PageTitle>
        <p className="text-sm text-muted-foreground">
          Adicione campos extras aos seus leads para capturar dados especificos
        </p>
      </div>
      <CustomFieldsClient initialFields={(fields || []) as never} />
    </div>
  );
}
