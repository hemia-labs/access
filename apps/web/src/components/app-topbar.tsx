"use client";

import { usePathname } from "next/navigation";
import { labelFor } from "@/lib/nav";

export function AppTopbar() {
  const title = labelFor(usePathname());
  return (
    <header className="flex h-topbar shrink-0 items-center gap-4 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">Administracion global de acceso</p>
      </div>
    </header>
  );
}
