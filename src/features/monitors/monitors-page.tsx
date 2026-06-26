import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Download,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Radio,
  Trash2,
} from "lucide-react";
import { AnimatedPage } from "@/components/animated-page";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MonitorBulkSettingsDialog } from "@/features/monitors/monitor-bulk-settings-dialog";
import { MonitorCreateDialog } from "@/features/monitors/monitor-create-dialog";
import { MonitorDetailPanel } from "@/features/monitors/monitor-detail-panel";
import { MonitorList } from "@/features/monitors/monitor-list";
import {
  deleteMonitor,
  listCookies,
  listMonitors,
  monitorDetail,
  pauseMonitor,
  resumeMonitor,
  runMonitorNow,
} from "@/lib/tauri";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { CookieRecord, Monitor, MonitorDetail } from "@/types/app";

export function MonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [cookies, setCookies] = useState<CookieRecord[]>([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, MonitorDetail>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 160);

  async function refresh() {
    const [nextMonitors, nextCookies] = await Promise.all([
      listMonitors().catch(() => []),
      listCookies().catch(() => []),
    ]);
    setMonitors(nextMonitors);
    setCookies(nextCookies);
    setSelectedId((current) =>
      nextMonitors.some((monitor) => monitor.id === current)
        ? current
        : null,
    );
    setSelectedIds((current) =>
      current.filter((id) => nextMonitors.some((monitor) => monitor.id === id)),
    );
  }

  async function refreshDetail(id: string | null) {
    if (!id) return;
    try {
      const detail = await monitorDetail(id);
      setDetails((current) => ({ ...current, [id]: detail }));
    } catch {
      // The list refresh will surface deleted or missing monitors.
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    void refreshDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
      void refreshDetail(selectedId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  const filteredMonitors = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    return monitors.filter((monitor) => {
      const matchesStatus = filter === "all" || monitor.status === filter;
      const searchable =
        `${monitor.authorName} ${monitor.secUserId} ${monitor.cookieName} ${monitor.url}`.toLowerCase();
      return matchesStatus && (!normalized || searchable.includes(normalized));
    });
  }, [debouncedQuery, filter, monitors]);

  const selectedMonitor = monitors.find((monitor) => monitor.id === selectedId);
  const selectedMonitors = useMemo(
    () => monitors.filter((monitor) => selectedIds.includes(monitor.id)),
    [monitors, selectedIds],
  );
  const summary = {
    total: monitors.length,
    running: monitors.filter((item) => item.status === "running").length,
    paused: monitors.filter((item) => item.status === "paused").length,
    error: monitors.filter((item) => item.status === "error").length,
    downloading: monitors.reduce(
      (sum, item) =>
        sum +
        (item.currentPhase === "downloading" ? item.currentDownloaded : 0),
      0,
    ),
  };

  async function runAction(
    key: string,
    label: string,
    action: () => Promise<void | number>,
  ) {
    setBusyAction(key);
    try {
      const result = await action();
      toast.success(
        typeof result === "number"
          ? `${label}完成：新增下载 ${result} 个作品`
          : `${label}完成`,
      );
      await refresh();
      await refreshDetail(selectedId);
    } catch (error) {
      toast.error(`${label}失败：${String(error)}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function runBulkAction(
    key: string,
    label: string,
    targets: Monitor[],
    action: (monitor: Monitor) => Promise<void | number>,
  ) {
    if (!targets.length) return;
    setBusyAction(key);
    try {
      let downloaded = 0;
      for (const monitor of targets) {
        const result = await action(monitor);
        if (typeof result === "number") {
          downloaded += result;
        }
      }
      toast.success(
        downloaded > 0
          ? `${label}完成：${targets.length} 个监听，新增下载 ${downloaded} 个作品`
          : `${label}完成：${targets.length} 个监听`,
      );
      await refresh();
      await refreshDetail(selectedId);
    } catch (error) {
      toast.error(`${label}失败：${String(error)}`);
    } finally {
      setBusyAction(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selected) => selected !== id)
        : [...current, id],
    );
  }

  function selectAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const monitor of filteredMonitors) {
        next.add(monitor.id);
      }
      return [...next];
    });
  }

  return (
    <AnimatedPage>
      <div className="flex min-h-full min-w-0 flex-col gap-4">
        <PageHeader
          eyebrow="后台监听"
          title="监听任务"
          actions={
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void refresh()}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
              <MonitorCreateDialog cookies={cookies} onCreated={refresh} />
            </>
          }
        />
        <SummaryStrip summary={summary} />
        <BulkActionBar
          selectedMonitors={selectedMonitors}
          cookies={cookies}
          busyAction={busyAction}
          onRun={() =>
            void runBulkAction(
              "bulk:run",
              "批量立即执行",
              selectedMonitors,
              (monitor) => runMonitorNow(monitor.id),
            )
          }
          onPause={() =>
            void runBulkAction(
              "bulk:pause",
              "批量暂停监听",
              selectedMonitors,
              (monitor) => pauseMonitor(monitor.id),
            )
          }
          onResume={() =>
            void runBulkAction(
              "bulk:resume",
              "批量恢复监听",
              selectedMonitors,
              (monitor) => resumeMonitor(monitor.id),
            )
          }
          onDelete={() =>
            void runBulkAction(
              "bulk:delete",
              "批量删除监听",
              selectedMonitors,
              async (monitor) => {
                await deleteMonitor(monitor.id);
                if (monitor.id === selectedId) {
                  setDetailOpen(false);
                  setSelectedId(null);
                }
                setSelectedIds((current) =>
                  current.filter((id) => id !== monitor.id),
                );
              },
            )
          }
          onSettingsSaved={async () => {
            await refresh();
            await refreshDetail(selectedId);
          }}
        />
        <MonitorList
          monitors={filteredMonitors}
          filter={filter}
          query={query}
          selectedIds={selectedIds}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onSelect={(id) => {
            setSelectedId(id);
            setDetailOpen(true);
          }}
          onToggleSelected={toggleSelected}
          onSelectAll={selectAllFiltered}
          onClearSelection={() => setSelectedIds([])}
        />
        <MonitorDetailPanel
          open={detailOpen}
          onOpenChange={setDetailOpen}
          monitor={selectedMonitor}
          detail={selectedId ? details[selectedId] : undefined}
          cookies={cookies}
          busyAction={busyAction}
          onRun={(monitor) =>
            void runAction(`run:${monitor.id}`, "立即执行", () =>
              runMonitorNow(monitor.id),
            )
          }
          onPause={(monitor) =>
            void runAction(`pause:${monitor.id}`, "暂停监听", () =>
              pauseMonitor(monitor.id),
            )
          }
          onResume={(monitor) =>
            void runAction(`resume:${monitor.id}`, "继续监听", () =>
              resumeMonitor(monitor.id),
            )
          }
          onDelete={(monitor) =>
            void runAction(`delete:${monitor.id}`, "删除监听", async () => {
              await deleteMonitor(monitor.id);
              setDetailOpen(false);
              setSelectedId(null);
              setSelectedIds((current) =>
                current.filter((id) => id !== monitor.id),
              );
            })
          }
          onSettingsSaved={async () => {
            await refresh();
            await refreshDetail(selectedId);
          }}
        />
      </div>
    </AnimatedPage>
  );
}

function BulkActionBar({
  selectedMonitors,
  cookies,
  busyAction,
  onRun,
  onPause,
  onResume,
  onDelete,
  onSettingsSaved,
}: {
  selectedMonitors: Monitor[];
  cookies: CookieRecord[];
  busyAction: string | null;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onSettingsSaved: () => Promise<void>;
}) {
  const selectedCount = selectedMonitors.length;
  const disabled = selectedCount === 0 || Boolean(busyAction);

  return (
    <div className="flex min-h-14 min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
      <Badge
        variant={selectedCount ? "default" : "secondary"}
        className="h-8 rounded-md px-3"
      >
        批量操作：{selectedCount} 项
      </Badge>
      <Button size="sm" disabled={disabled} onClick={onRun}>
        {busyAction === "bulk:run" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        {busyAction === "bulk:run" ? "执行中" : "立即执行"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={onPause}
      >
        {busyAction === "bulk:pause" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PauseCircle data-icon="inline-start" />
        )}
        {busyAction === "bulk:pause" ? "暂停中" : "暂停"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={onResume}
      >
        {busyAction === "bulk:resume" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PlayCircle data-icon="inline-start" />
        )}
        {busyAction === "bulk:resume" ? "恢复中" : "恢复"}
      </Button>
      <MonitorBulkSettingsDialog
        monitors={selectedMonitors}
        cookies={cookies}
        disabled={disabled}
        onSaved={onSettingsSaved}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={disabled}>
            {busyAction === "bulk:delete" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {busyAction === "bulk:delete" ? "删除中" : "删除"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除已选择的监听？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {selectedCount} 个监听任务。已下载的作品文件不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: {
    total: number;
    running: number;
    paused: number;
    error: number;
    downloading: number;
  };
}) {
  return (
    <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <SummaryPill
        icon={<Radio className="size-3.5" />}
        label="总监听"
        value={summary.total}
      />
      <SummaryPill
        icon={<Activity className="size-3.5" />}
        label="监听中"
        value={summary.running}
      />
      <SummaryPill
        icon={<PauseCircle className="size-3.5" />}
        label="已暂停"
        value={summary.paused}
      />
      <SummaryPill
        icon={<AlertTriangle className="size-3.5" />}
        label="错误"
        value={summary.error}
        variant={summary.error > 0 ? "destructive" : "secondary"}
      />
      <SummaryPill
        icon={<Download className="size-3.5" />}
        label="本轮下载中"
        value={summary.downloading}
      />
    </div>
  );
}

function SummaryPill({
  icon,
  label,
  value,
  variant = "secondary",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  variant?: ComponentProps<typeof Badge>["variant"];
}) {
  return (
    <Badge variant={variant} className="h-8 gap-2 rounded-md px-3">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </Badge>
  );
}
