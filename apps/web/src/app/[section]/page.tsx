import { labelFor } from "@/lib/nav";

// ponytail: one stub for documents/team/settings. Replace with real pages as each is built.
export default async function Section({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const title = labelFor(`/${section}`);

  return (
    <div className="grid min-h-panel-min place-items-center rounded-lg border border-border bg-card text-center shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sección en construcción.</p>
      </div>
    </div>
  );
}
