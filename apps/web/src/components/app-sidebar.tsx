"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { nav } from "@/lib/nav";

export function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out md:flex",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar"
      )}
    >
      <div className="flex h-topbar items-center gap-2 px-4">
        {!collapsed && <span className="flex-1 truncate text-lg font-bold">Nextjs Template</span>}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!collapsed}
          className="grid size-12 shrink-0 place-items-center rounded-md text-blue-50/95 transition-colors hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <PanelLeftOpen className="size-6" /> : <PanelLeftClose className="size-6" />}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-4 py-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-0" : "px-3",
                active
                  ? "bg-primary text-primary-foreground shadow-lg shadow-blue-950/25"
                  : "text-blue-50/95 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span className={cn(collapsed && "sr-only")}>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="m-4 flex items-center gap-2 rounded-lg bg-white/5 p-3 text-xs">
        <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
        {!collapsed && <span className="truncate text-blue-50/95">Sistema operativo</span>}
      </div>
    </aside>
  );
}
