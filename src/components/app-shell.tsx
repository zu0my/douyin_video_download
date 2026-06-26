import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Activity, Cookie, Folder, Search } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { DouyinIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/monitors", label: "监听", icon: Activity },
  { to: "/videos", label: "视频", icon: Folder },
  { to: "/cookies", label: "Cookie", icon: Cookie },
  { to: "/ai", label: "AI 搜索", icon: Search },
] as const;

export function AppShell() {
  const location = useLocation();

  if (location.pathname === "/player") {
    return (
      <>
        <Outlet />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  return (
    <main className="grid h-dvh min-h-0 grid-cols-[64px_minmax(0,1fr)] overflow-hidden bg-background text-foreground lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-card/70 px-2 py-4 lg:px-3">
        <div className="mb-5 flex items-center justify-center gap-3 rounded-lg px-0 py-3 lg:justify-start lg:px-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <DouyinIcon width={20} height={20} />
          </div>
          <div className="hidden min-w-0 lg:block">
            <strong className="block truncate text-sm">Douyin Archive</strong>
            <span className="block truncate text-xs text-muted-foreground">
              desktop monitor
            </span>
          </div>
        </div>
        <nav className="grid gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:justify-start"
                activeProps={{
                  className: cn(
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  ),
                }}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden truncate lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-3 lg:p-5">
        <Outlet />
      </section>
      <Toaster richColors position="top-right" />
    </main>
  );
}
