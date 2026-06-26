import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function VideoFilters({
  query,
  onQueryChange,
  onDeleteAll,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onDeleteAll: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <div className="relative min-w-64 flex-1">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-8"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="按 desc 搜索视频"
        />
      </div>
      <Button variant="destructive" onClick={onDeleteAll}>
        <Trash2 data-icon="inline-start" />
        删除所有视频
      </Button>
    </div>
  );
}
