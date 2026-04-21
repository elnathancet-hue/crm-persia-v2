import { InstancesClient } from "./instances-client";

export default function AdminInstancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-heading">Gerenciar Instancias WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Crie, conecte e gerencie instancias para seus clientes
        </p>
      </div>
      <InstancesClient />
    </div>
  );
}
