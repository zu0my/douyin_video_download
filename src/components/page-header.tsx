import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
          {title}
        </h1>
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
