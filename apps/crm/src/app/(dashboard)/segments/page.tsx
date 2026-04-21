import { getSegments } from "@/actions/segments";
import { SegmentList } from "@/components/segments/segment-list";

export default async function SegmentsPage() {
  const segments = await getSegments();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-heading">Segmentações</h1>
          <p className="text-sm text-muted-foreground">
            Crie grupos dinamicos de leads baseados em regras
          </p>
        </div>
      </div>
      <SegmentList segments={(segments || []) as never} />
    </div>
  );
}
