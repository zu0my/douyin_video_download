import { Badge } from "@/components/ui/badge";

const labels: Record<string, string> = {
  running: "监听中",
  paused: "已暂停",
  error: "错误",
  completed: "完成",
  downloading: "下载中",
  failed: "失败",
  deleted: "已删除",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const variant =
    status === "error" || status === "failed" || status === "deleted"
      ? "destructive"
      : status === "paused" || status === "downloading"
        ? "secondary"
        : status === "completed"
          ? "outline"
          : "default";
  return (
    <Badge variant={variant} className={className}>
      {labels[status] || status}
    </Badge>
  );
}
