import { FileText, Users, Clock, CheckCircle2 } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const docs = [
  { name: "Política de privacidad", owner: "Ana Ruiz", status: "Publicado", tone: "ok" },
  { name: "Contrato proveedor Q3", owner: "Luis Gómez", status: "Revisión", tone: "warn" },
  { name: "Manual de onboarding", owner: "María Paz", status: "Borrador", tone: "muted" },
  { name: "Acuerdo NDA cliente X", owner: "Jorge Díaz", status: "Archivado", tone: "danger" },
];

const badge: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  muted: "bg-muted text-muted-foreground",
  danger: "bg-red-50 text-red-700",
};

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Documentos" value="1,284" icon={<FileText className="size-5" />} />
        <StatCard label="En revisión" value="37" tone="violet" icon={<Clock className="size-5" />} />
        <StatCard label="Publicados" value="912" icon={<CheckCircle2 className="size-5" />} />
        <StatCard label="Colaboradores" value="48" icon={<Users className="size-5" />} />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Documentos recientes</h2>
          <span className="text-xs text-muted-foreground">{docs.length} resultados</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Nombre</TableHead>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Responsable</TableHead>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.name}>
                <TableCell className="px-4 py-3 font-medium">{d.name}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{d.owner}</TableCell>
                <TableCell className="px-4 py-3">
                  <Badge variant="secondary" className={badge[d.tone]}>
                    {d.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
