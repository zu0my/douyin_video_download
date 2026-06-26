import type { ReactNode } from "react";
import {
  CalendarClock,
  Copy,
  FolderOpen,
  LinkIcon,
  Radio,
  Timer,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { MonitorActions } from "@/features/monitors/monitor-actions";
import { MonitorRunStatus } from "@/features/monitors/monitor-progress";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { CookieRecord, Monitor, MonitorDetail } from "@/types/app";

interface MonitorDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor?: Monitor;
  detail?: MonitorDetail;
  cookies: CookieRecord[];
  busyAction: string | null;
  onRun: (monitor: Monitor) => void;
  onPause: (monitor: Monitor) => void;
  onResume: (monitor: Monitor) => void;
  onDelete: (monitor: Monitor) => void;
  onSettingsSaved: () => Promise<void>;
}

export function MonitorDetailPanel({
  open,
  onOpenChange,
  monitor,
  detail,
  cookies,
  busyAction,
  onRun,
  onPause,
  onResume,
  onDelete,
  onSettingsSaved,
}: MonitorDetailPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {monitor ? (
          <>
            <div className="relative overflow-hidden border-b bg-muted/25 px-6 pb-5 pt-6">
              <div className="absolute -right-12 -top-16 size-44 rounded-full bg-primary/8 blur-2xl" />
              <DialogHeader className="relative pr-10">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl border bg-background text-primary shadow-sm">
                    <Radio className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <DialogTitle className="truncate text-xl">
                        {monitor.authorName || monitor.secUserId}
                      </DialogTitle>
                      <StatusBadge status={monitor.status} />
                    </div>
                    <DialogDescription className="mt-1.5 min-w-0">
                      <CopyText
                        value={monitor.url}
                        className="text-left text-sm text-muted-foreground"
                      />
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <div className="grid gap-5 p-6">
                <MonitorRunStatus monitor={monitor} />
                <MonitorActions
                  monitor={monitor}
                  busyAction={busyAction}
                  cookies={cookies}
                  onRun={onRun}
                  onPause={onPause}
                  onResume={onResume}
                  onDelete={onDelete}
                  onSettingsSaved={onSettingsSaved}
                />
                <Separator />
                <div>
                  <h3 className="mb-3 text-sm font-semibold">监听信息</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Detail
                      icon={<UserRound className="size-4" />}
                      label="用户 ID"
                      value={monitor.secUserId}
                    />
                    <Detail
                      icon={<FolderOpen className="size-4" />}
                      label="已下载作品"
                      value={`${monitor.videoCount} 个`}
                      copyable={false}
                    />
                    <Detail
                      icon={<Timer className="size-4" />}
                      label="监听间隔"
                      value={`${monitor.intervalMinutes} 分钟`}
                      copyable={false}
                    />
                    <Detail
                      icon={<CalendarClock className="size-4" />}
                      label="最近执行"
                      value={
                        monitor.lastRunAt
                          ? formatRelativeTime(monitor.lastRunAt)
                          : "等待首次执行"
                      }
                      copyable={false}
                    />
                    <Detail
                      icon={<FolderOpen className="size-4" />}
                      label="保存目录"
                      value={detail?.userDownloadsDir || "加载中"}
                      className="sm:col-span-2"
                    />
                    <Detail
                      icon={<LinkIcon className="size-4" />}
                      label="最近结果"
                      value={monitor.lastResult || "暂无结果"}
                      className="sm:col-span-2"
                      copyable={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-muted-foreground">
            正在加载监听详情
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  icon,
  label,
  value,
  className,
  copyable = true,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  className?: string;
  copyable?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-muted/15 p-3",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      {copyable ? (
        <CopyText value={value} className="text-sm font-medium" />
      ) : (
        <div className="min-w-0 truncate text-sm font-medium" title={value}>
          {value}
        </div>
      )}
    </div>
  );
}

function CopyText({ value, className }: { value: string; className?: string }) {
  async function copy() {
    try {
      await copyToClipboard(value);
      toast.success("已复制");
    } catch (error) {
      toast.error(`复制失败：${String(error)}`);
    }
  }

  return (
    <button
      type="button"
      title={`${value}\n点击复制`}
      className={cn(
        "group flex h-auto min-w-0 max-w-full items-center gap-2 text-left transition-colors hover:text-foreground",
        className,
      )}
      onClick={copy}
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Copy className="size-3.5 shrink-0 opacity-45 transition-opacity group-hover:opacity-80" />
    </button>
  );
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
