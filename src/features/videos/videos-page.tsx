import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { AnimatedPage } from "@/components/animated-page";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { VideoFilters } from "@/features/videos/video-filters";
import { VideoTree } from "@/features/videos/video-tree";
import { listVideoTree, softDeleteAllVideos } from "@/lib/tauri";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { VideoTreeUser } from "@/types/app";

export function VideosPage() {
  const [videos, setVideos] = useState<VideoTreeUser[]>([]);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const isSearching = debouncedQuery.trim().length > 0;

  const refresh = useCallback(async () => {
    setVideos(await listVideoTree().catch(() => []));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredVideos = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    if (!normalized) return videos;
    return videos
      .map((user) => ({
        ...user,
        dates: user.dates
          .map((date) => ({
            ...date,
            videos: date.videos.filter((video) =>
              video.desc.toLowerCase().includes(normalized),
            ),
          }))
          .filter((date) => date.videos.length > 0),
      }))
      .filter((user) => user.dates.length > 0);
  }, [debouncedQuery, videos]);

  const deleteAll = useCallback(async () => {
    try {
      await softDeleteAllVideos();
      toast.success("所有作品已移入回收站");
      await refresh();
    } catch (error) {
      toast.error(`删除所有作品失败：${String(error)}`);
    }
  }, [refresh]);

  return (
    <AnimatedPage>
      <div className="flex h-[calc(100dvh-1.5rem)] min-h-0 min-w-0 flex-col gap-4 lg:h-[calc(100dvh-2.5rem)]">
        <PageHeader eyebrow="本地作品库" title="下载作品" />
        <VideoFilters
          query={query}
          onQueryChange={setQuery}
          onDeleteAll={deleteAll}
        />
        {filteredVideos.length ? (
          <VideoTree
            users={filteredVideos}
            onChanged={refresh}
            expandAll={isSearching}
          />
        ) : (
          <EmptyState
            icon={<FolderOpen />}
            title="没有作品"
            description="下载完成的视频、图片和混合作品会按用户和日期显示在这里。"
          />
        )}
      </div>
    </AnimatedPage>
  );
}
