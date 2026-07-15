import { Building2, KeyRound, PackageCheck, ShieldCheck } from "lucide-react";
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
import {
  getOrganizations,
  getPermissions,
  getProducts,
  getRoles,
  type AccessOrganization,
} from "@/lib/access-api";

async function loadDashboard() {
  try {
    const [organizations, products, roles, permissions] = await Promise.all([
      getOrganizations(),
      getProducts(),
      getRoles(),
      getPermissions(),
    ]);
    return { organizations, products, roles, permissions, error: null };
  } catch (error) {
    return {
      organizations: [] as AccessOrganization[],
      products: [],
      roles: [],
      permissions: [],
      error: error instanceof Error ? error.message : "Access API unavailable",
    };
  }
}

export default async function Home() {
  const { organizations, products, roles, permissions, error } = await loadDashboard();

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Access API no disponible o sin credenciales: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Organizations" value={String(organizations.length)} icon={<Building2 className="size-5" />} />
        <StatCard label="Products" value={String(products.length)} icon={<PackageCheck className="size-5" />} />
        <StatCard label="Roles" value={String(roles.length)} icon={<ShieldCheck className="size-5" />} />
        <StatCard label="Permissions" value={String(permissions.length)} icon={<KeyRound className="size-5" />} />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Organizations</h2>
          <span className="text-xs text-muted-foreground">{organizations.length} resultados</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Nombre</TableHead>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Codigo</TableHead>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Tipo</TableHead>
              <TableHead className="px-4 text-xs font-semibold text-muted-foreground">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell className="px-4 py-3 font-medium">{organization.name}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{organization.code}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{organization.type}</TableCell>
                <TableCell className="px-4 py-3">
                  <Badge variant="secondary">{organization.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
