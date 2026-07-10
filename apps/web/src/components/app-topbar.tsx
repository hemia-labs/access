"use client";

import { Search, Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labelFor } from "@/lib/nav";

export function AppTopbar() {
  const title = labelFor(usePathname());
  return (
    <header className="flex h-topbar shrink-0 items-center gap-4 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">Resumen del workspace</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" placeholder="Buscar..." className="h-12 w-64 pl-9" />
        </div>
        <Button variant="ghost" size="icon" aria-label="Notificaciones" className="size-12">
          <Bell className="size-4" />
        </Button>
      </div>
    </header>
  );
}
