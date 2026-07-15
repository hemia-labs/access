import {
  Building2,
  KeyRound,
  LayoutDashboard,
  PackageCheck,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

export const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/memberships", label: "Memberships", icon: Users },
  { href: "/invitations", label: "Invitations", icon: UserPlus },
  { href: "/products", label: "Products", icon: PackageCheck },
  { href: "/roles", label: "Roles", icon: ShieldCheck },
  { href: "/permissions", label: "Permissions", icon: KeyRound },
];

export function labelFor(pathname: string) {
  const match = nav
    .filter((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Sección";
}
