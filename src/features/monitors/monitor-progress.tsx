import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "@/lib/utils";
import type { Monitor } from "@/types/app";

export function progressText(item: Monitor) {
  if (item.status === "error") return "错误";
  if (item.currentPhase === "collecting" || item.currentPhase === "filtering")
    return "采集信息";
  if (item.currentPhase === "downloading") return "下载中";
  return "空闲";
}

export function progressPercent(item: Monitor) {
  if (item.currentPhase === "collecting") return 16;
  if (item.currentPhase === "filtering") return 38;
  if (!item.currentTotal) return 0;
  return Math.min(
    100,
    Math.round((item.currentDownloaded / item.currentTotal) * 100),
  );
}

function phaseDescription(monitor: Monitor) {
  if (monitor.status === "error")
    return monitor.lastResult || "最近一次执行失败";
  if (monitor.currentPhase === "collecting") return "正在获取用户作品列表";
  if (monitor.currentPhase === "filtering") return "正在筛选本地尚未下载的作品";
  if (monitor.currentPhase === "downloading") {
    if (monitor.currentTotal <= 0) return "当前没有需要下载的新增作品";
    return monitor.currentItem
      ? `当前：${monitor.currentItem}`
      : "正在保存作品资源和 manifest";
  }
  return monitor.lastRunAt ? `上次运行：${formatRelativeTime(monitor.lastRunAt)}` : "等待首次执行";
}

export function MonitorRunStatus({
  monitor,
  compact = false,
}: {
  monitor: Monitor;
  compact?: boolean;
}) {
  const text = progressText(monitor);
  const percent = progressPercent(monitor);
  const isDownloading =
    monitor.currentPhase === "downloading" && monitor.currentTotal > 0;

  return (
    <div
      className={
        compact
          ? "flex min-w-0 flex-col gap-2"
          : "flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4"
      }
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {!compact && (
              <Badge
                variant={
                  monitor.status === "error"
                    ? "destructive"
                    : isDownloading
                      ? "default"
                      : "secondary"
                }
              >
                {text}
              </Badge>
            )}
            <motion.strong
              key={`${monitor.currentDownloaded}-${monitor.currentTotal}-${monitor.videoCount}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className={compact ? "truncate text-xs font-medium" : "text-sm font-semibold"}
            >
              {isDownloading
                ? `${monitor.currentDownloaded}/${monitor.currentTotal}`
                : compact
                  ? phaseDescription(monitor)
                  : `已下载 ${monitor.videoCount}`}
            </motion.strong>
          </div>
          {!compact && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {phaseDescription(monitor)}
            </p>
          )}
        </div>
        {!compact && (
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>需要下载</div>
            <strong className="text-base text-foreground">
              {monitor.currentTotal || 0}
            </strong>
          </div>
        )}
      </div>
      <Progress value={percent} className={compact ? "h-1.5" : "h-2.5"} />
    </div>
  );
}
