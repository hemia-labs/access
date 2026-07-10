import { LayoutDashboard, FileText, Users, Settings } from "lucide-react";

export const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documentos", icon: FileText },
  { href: "/team", label: "Equipo", icon: Users },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

export function labelFor(pathname: string) {
  const match = nav
    .filter((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Sección";
}
