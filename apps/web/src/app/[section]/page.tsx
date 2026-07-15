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
  getOrganizationInvitations,
  getOrganizationMemberships,
  getOrganizations,
  getPermissions,
  getProducts,
  getRoles,
} from "@/lib/access-api";
import { labelFor } from "@/lib/nav";

type Row = Record<string, string | number | null | undefined>;

const columns: Record<string, Array<{ key: string; label: string }>> = {
  organizations: [
    { key: "name", label: "Nombre" },
    { key: "code", label: "Codigo" },
    { key: "type", label: "Tipo" },
    { key: "status", label: "Estado" },
  ],
  memberships: [
    { key: "identity", label: "Identidad" },
    { key: "type", label: "Tipo" },
    { key: "status", label: "Estado" },
  ],
  invitations: [
    { key: "email", label: "Email" },
    { key: "product", label: "Producto" },
    { key: "status", label: "Estado" },
  ],
  products: [
    { key: "name", label: "Nombre" },
    { key: "code", label: "Codigo" },
    { key: "audience", label: "Audiencia" },
    { key: "status", label: "Estado" },
  ],
  roles: [
    { key: "name", label: "Nombre" },
    { key: "code", label: "Codigo" },
    { key: "scope", label: "Scope" },
    { key: "status", label: "Estado" },
  ],
  permissions: [
    { key: "code", label: "Codigo" },
    { key: "scope", label: "Scope" },
    { key: "status", label: "Estado" },
  ],
};

async function rowsFor(section: string): Promise<{ rows: Row[]; note?: string }> {
  if (section === "organizations") return { rows: await getOrganizations() };
  if (section === "products") return { rows: await getProducts() };
  if (section === "roles") return { rows: await getRoles() };
  if (section === "permissions") return { rows: await getPermissions() };

  const [first] = await getOrganizations();
  if (!first) return { rows: [], note: "No hay organizations para consultar." };

  if (section === "memberships") {
    const memberships = await getOrganizationMemberships(first.id);
    return {
      rows: memberships.map((membership) => ({
        id: membership.id,
        identity:
          membership.identityReference?.emailSnapshot ??
          membership.identityReference?.subjectId ??
          membership.id,
        type: membership.membership_type ?? "member",
        status: membership.status,
      })),
      note: `Mostrando memberships de ${first.name}.`,
    };
  }

  if (section === "invitations") {
    const invitations = await getOrganizationInvitations(first.id);
    return {
      rows: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        product: invitation.product_code ?? "global",
        status: invitation.status,
      })),
      note: `Mostrando invitations de ${first.name}.`,
    };
  }

  return { rows: [] };
}

export default async function Section({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const title = labelFor(`/${section}`);
  const tableColumns = columns[section];

  if (!tableColumns) {
    return (
      <div className="grid min-h-panel-min place-items-center rounded-lg border border-border bg-card text-center shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Seccion no encontrada</h2>
          <p className="mt-1 text-sm text-muted-foreground">{section}</p>
        </div>
      </div>
    );
  }

  let rows: Row[] = [];
  let note: string | undefined;
  let error: string | null = null;
  try {
    const result = await rowsFor(section);
    rows = result.rows;
    note = result.note;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Access API unavailable";
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
          {error && <p className="mt-1 text-xs text-amber-700">{error}</p>}
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} resultados</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {tableColumns.map((column) => (
              <TableHead key={column.key} className="px-4 text-xs font-semibold text-muted-foreground">
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={String(row.id ?? index)}>
              {tableColumns.map((column) => (
                <TableCell key={column.key} className="px-4 py-3">
                  {column.key === "status" ? (
                    <Badge variant="secondary">{String(row[column.key] ?? "-")}</Badge>
                  ) : (
                    <span className="text-sm">{String(row[column.key] ?? "-")}</span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
