import { memo, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronRight, FolderOpen, Images, ImageIcon, Play, Trash2, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VideoFileIcon } from "@/lib/icons";
import { openVideoPlayer } from "@/lib/player-window";
import { openUserVideosFolder, softDeleteUserVideos, softDeleteVideo } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { VideoTreeUser } from "@/types/app";

export const VideoTree = memo(function VideoTree({
  users,
  onChanged,
  expandAll,
}: {
  users: VideoTreeUser[];
  onChanged: () => Promise<void>;
  expandAll: boolean;
}) {
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 pr-3">
      <div className="grid gap-2">
        {users.map((user) => (
          <UserGroup
            key={user.secUserId}
            user={user}
            onChanged={onChanged}
            expandAll={expandAll}
          />
        ))}
      </div>
    </ScrollArea>
  );
});

function UserGroup({
  user,
  onChanged,
  expandAll,
}: {
  user: VideoTreeUser;
  onChanged: () => Promise<void>;
  expandAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = expandAll || open;
  const videoCount = user.dates.reduce(
    (sum, date) => sum + date.videos.length,
    0,
  );

  const allVideos = useMemo(() => {
    return user.dates.flatMap((date) =>
      date.videos.map((video) => ({
        ...video,
        date: date.date,
      })),
    );
  }, [user.dates]);

  const firstPlayableVideo = useMemo(() => {
    return allVideos.find((video) => video.status === "completed");
  }, [allVideos]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      className="min-w-0 rounded-lg border bg-card shadow-sm"
    >
      <div className="flex min-h-14 min-w-0 items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
              <UserRound size={15} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {user.authorName || user.secUserId}
              </div>
              <p className="text-xs text-muted-foreground">{videoCount} 个作品</p>
            </div>
          </div>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={!firstPlayableVideo}
          aria-label={`浏览 ${user.authorName || user.secUserId} 的作品`}
          title={`浏览 ${user.authorName || user.secUserId} 的作品`}
          onClick={async () => {
            if (!firstPlayableVideo) return;
            try {
              await openVideoPlayer(firstPlayableVideo.id, user.authorName || "视频播放");
            } catch (error) {
              toast.error(`打开播放器失败：${String(error)}`);
            }
          }}
        >
          <Play data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={`打开 ${user.authorName || user.secUserId} 的作品文件夹`}
          title={`打开 ${user.authorName || user.secUserId} 的作品文件夹`}
          onClick={async () => {
            try {
              await openUserVideosFolder(user.secUserId);
            } catch (error) {
              toast.error(`打开作品文件夹失败：${String(error)}`);
            }
          }}
        >
          <FolderOpen data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-destructive hover:text-destructive"
          aria-label={`删除 ${user.authorName || user.secUserId} 的全部作品`}
          title={`删除 ${user.authorName || user.secUserId} 的全部作品`}
          onClick={async () => {
            try {
              await softDeleteUserVideos(user.secUserId);
              toast.success("该作者的作品已全部移入回收站");
              await onChanged();
            } catch (error) {
              toast.error(`删除作者作品失败：${String(error)}`);
            }
          }}
        >
          <Trash2 data-icon="inline-start" />
        </Button>
      </div>
      {isOpen && (
        <CollapsibleContent>
          <div className="grid gap-1 px-2.5 pb-2.5">
            {allVideos.map((video) => (
              <motion.div
                key={video.id}
                layout
                className="grid min-h-11 min-w-0 grid-cols-[48px_80px_50px_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 rounded-md bg-background px-2"
              >
                <div className="aspect-[9/16] overflow-hidden rounded bg-muted">
                  {video.coverPath ? (
                    <img
                      className="size-full object-cover"
                      src={convertFileSrc(video.coverPath)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <ImageIcon className="size-4" />
                    </div>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {video.date}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {video.time}
                </span>
                <strong className="min-w-0 truncate text-sm font-medium">
                  {video.desc || "(无描述)"}
                </strong>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {video.kind === "video" ? (
                    <Play className="size-3.5" />
                  ) : (
                    <Images className="size-3.5" />
                  )}
                  {video.kind === "mixed"
                    ? `混合 ${video.mediaCount}`
                    : video.kind === "image"
                      ? `图片 ${video.mediaCount}`
                      : "视频"}
                </span>
                <StatusBadge status={video.status} />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={video.status !== "completed"}
                  aria-label="播放视频"
                  title="播放视频"
                  onClick={async () => {
                    try {
                      await openVideoPlayer(video.id, video.desc || "视频播放");
                    } catch (error) {
                      toast.error(`打开播放器失败：${String(error)}`);
                    }
                  }}
                >
                  <Play data-icon="inline-start" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label="删除该视频"
                  title="删除该视频"
                  onClick={async () => {
                    try {
                      await softDeleteVideo(video.id);
                      toast.success("作品已删除");
                      await onChanged();
                    } catch (error) {
                      toast.error(`删除视频失败：${String(error)}`);
                    }
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                </Button>
              </motion.div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
