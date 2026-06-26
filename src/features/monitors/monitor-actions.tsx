import { Download, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MonitorSettingsDialog } from "@/features/monitors/monitor-settings-dialog";
import type { CookieRecord, Monitor } from "@/types/app";

interface MonitorActionsProps {
  monitor: Monitor;
  busyAction: string | null;
  onRun: (monitor: Monitor) => void;
  onPause: (monitor: Monitor) => void;
  onResume: (monitor: Monitor) => void;
  onDelete: (monitor: Monitor) => void;
  cookies: CookieRecord[];
  onSettingsSaved: () => Promise<void>;
}

export function MonitorActions({
  monitor,
  busyAction,
  onRun,
  onPause,
  onResume,
  onDelete,
  cookies,
  onSettingsSaved,
}: MonitorActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={busyAction === `run:${monitor.id}`}
        onClick={() => onRun(monitor)}
      >
        {busyAction === `run:${monitor.id}` ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        {busyAction === `run:${monitor.id}` ? "执行中" : "立即执行"}
      </Button>
      {monitor.status === "paused" ? (
        <Button size="sm" variant="secondary" onClick={() => onResume(monitor)}>
          <Play data-icon="inline-start" />
          恢复监听
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => onPause(monitor)}>
          <Pause data-icon="inline-start" />
          暂停监听
        </Button>
      )}
      <Button size="sm" variant="destructive" onClick={() => onDelete(monitor)}>
        <Trash2 data-icon="inline-start" />
        删除
      </Button>
      <MonitorSettingsDialog
        monitor={monitor}
        cookies={cookies}
        onSaved={onSettingsSaved}
      />
    </div>
  );
}
