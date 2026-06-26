import { memo, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  CalendarClock,
  Cookie,
  Download,
  Radio,
  Search,
  Timer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { MonitorRunStatus } from "@/features/monitors/monitor-progress";
import { listContainer, listItem } from "@/lib/motion";
import { formatRelativeTime } from "@/lib/utils";
import type { Monitor } from "@/types/app";

interface MonitorListProps {
  monitors: Monitor[];
  filter: string;
  query: string;
  onFilterChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
}

export function MonitorList({
  monitors,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onSelect,
}: MonitorListProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="border-border/80 bg-card/80 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
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
        </CardContent>
      </Card>
      <MonitorRows monitors={monitors} onSelect={onSelect} />
    </div>
  );
}

const MonitorRows = memo(function MonitorRows({
  monitors,
  onSelect,
}: {
  monitors: Monitor[];
  onSelect: (id: string) => void;
}) {
  return (
    <motion.div
      variants={listContainer}
      initial="initial"
      animate="animate"
      className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3"
    >
      {monitors.map((monitor) => (
        <motion.button
          type="button"
          key={monitor.id}
          variants={listItem}
          transition={{ duration: 0.16 }}
          onClick={() => onSelect(monitor.id)}
          className="group relative flex min-h-64 min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <StatusBadge
              status={monitor.status}
              className="max-w-20 shrink-0 truncate"
            />
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
        </motion.button>
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
