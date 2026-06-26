import { memo, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  CalendarClock,
  CheckSquare,
  Cookie,
  Download,
  Radio,
  Search,
  Timer,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { MonitorRunStatus } from "@/features/monitors/monitor-progress";
import { listContainer, listItem } from "@/lib/motion";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Monitor } from "@/types/app";

interface MonitorListProps {
  monitors: Monitor[];
  filter: string;
  query: string;
  selectedIds: string[];
  onFilterChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function MonitorList({
  monitors,
  filter,
  query,
  selectedIds,
  onFilterChange,
  onQueryChange,
  onSelect,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
}: MonitorListProps) {
  const selectedCount = selectedIds.length;
  const allVisibleSelected =
    monitors.length > 0 &&
    monitors.every((monitor) => selectedIds.includes(monitor.id));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="border-border/80 bg-card/80 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 border-0 bg-muted/55 pl-9 shadow-none"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索用户名、用户 ID 或 Cookie"
              />
            </div>
            <Tabs
              value={filter}
              onValueChange={onFilterChange}
              className="shrink-0"
            >
              <TabsList className="grid h-10 w-full grid-cols-4 md:w-[340px]">
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="running">监听中</TabsTrigger>
                <TabsTrigger value="paused">已暂停</TabsTrigger>
                <TabsTrigger value="error">错误</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={allVisibleSelected ? "secondary" : "outline"}
              size="sm"
              disabled={!monitors.length}
              onClick={onSelectAll}
            >
              <CheckSquare data-icon="inline-start" />
              全选当前列表
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!selectedCount}
              onClick={onClearSelection}
            >
              <X data-icon="inline-start" />
              清空选择
            </Button>
            {selectedCount > 0 && (
              <Badge variant="secondary" className="h-8 rounded-md px-3">
                已选择 {selectedCount} 项
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
      <MonitorRows
        monitors={monitors}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onToggleSelected={onToggleSelected}
      />
    </div>
  );
}

const MonitorRows = memo(function MonitorRows({
  monitors,
  selectedIds,
  onSelect,
  onToggleSelected,
}: {
  monitors: Monitor[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
}) {
  return (
    <motion.div
      variants={listContainer}
      initial="initial"
      animate="animate"
      className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3"
    >
      {monitors.map((monitor) => (
        <motion.div
          key={monitor.id}
          role="button"
          tabIndex={0}
          aria-label={`查看 ${monitor.authorName || monitor.secUserId} 的监听详情`}
          variants={listItem}
          transition={{ duration: 0.16 }}
          onClick={() => onSelect(monitor.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(monitor.id);
            }
          }}
          className={cn(
            "group relative flex min-h-64 min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selectedIds.includes(monitor.id) &&
              "border-primary/60 bg-primary/5 shadow-md ring-1 ring-primary/20",
          )}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20 opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted/45 text-primary">
                <Radio className="size-4.5" />
              </div>
              <div className="min-w-0">
                <strong className="block truncate text-base">
                  {monitor.authorName || monitor.secUserId}
                </strong>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {monitor.secUserId}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div
                className={cn(
                  "transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
                  selectedIds.includes(monitor.id)
                    ? "opacity-100"
                    : "pointer-events-none opacity-0",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={selectedIds.includes(monitor.id)}
                  onCheckedChange={() => onToggleSelected(monitor.id)}
                  aria-label={`选择 ${monitor.authorName || monitor.secUserId}`}
                  className="size-5 bg-background"
                />
              </div>
              <StatusBadge
                status={monitor.status}
                className="max-w-20 shrink-0 truncate"
              />
            </div>
          </div>
          <div className="my-4 h-px bg-border/70" />
          <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
            <Meta
              icon={<Download className="size-3.5" />}
              label="已下载"
              value={`${monitor.videoCount} 个作品`}
            />
            <Meta
              icon={<Timer className="size-3.5" />}
              label="监听间隔"
              value={`${monitor.intervalMinutes} 分钟`}
            />
            <Meta
              icon={<CalendarClock className="size-3.5" />}
              label="最近执行"
              value={
                monitor.lastRunAt
                  ? formatRelativeTime(monitor.lastRunAt)
                  : "等待首次执行"
              }
            />
            <Meta
              icon={<Cookie className="size-3.5" />}
              label="使用 Cookie"
              value={monitor.cookieName}
            />
          </div>
          <div className="mt-auto pt-4">
            <MonitorRunStatus monitor={monitor} compact />
          </div>
          <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
            查看详情
            <ArrowUpRight className="size-3.5" />
          </div>
        </motion.div>
      ))}
      {!monitors.length && (
        <div className="col-span-full grid min-h-56 place-items-center rounded-xl border border-dashed bg-card/40 p-8 text-center">
          <div>
            <Radio className="mx-auto mb-3 size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">没有符合条件的监听</p>
            <p className="mt-1 text-xs text-muted-foreground">
              尝试调整筛选条件或搜索关键词
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
});

function Meta({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="truncate text-xs">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
