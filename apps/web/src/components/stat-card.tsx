import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  tone?: "blue" | "violet";
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-secondary text-primary"
        )}
      >
        {icon}
      </div>
      <p className="mt-4 truncate text-sm font-bold">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
