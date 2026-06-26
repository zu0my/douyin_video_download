import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  ImageIcon,
  Images,
  Minus,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { createPlayer } from "@videojs/react";
import { Video, VideoSkin, videoFeatures } from "@videojs/react/video";
import "@videojs/react/video/skin.css";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { softDeleteVideo, videoPlaylist } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { VideoPlayerDetail, VideoPlaylist } from "@/types/app";

const Player = createPlayer({
  features: videoFeatures,
  displayName: "DouyinVideoPlayer",
});
const PLAYER_VOLUME_KEY = "douyin-player-volume";
const PLAYER_MUTED_KEY = "douyin-player-muted";
const PLAYER_ORDER_KEY = "douyin-player-order";
const PLAYER_BGM_VOLUME_KEY = "douyin-player-bgm-volume";
const IMAGE_SLIDE_DURATION_MS = 4_000;

type PlayOrder = "sequence" | "reverse" | "loop";

const playOrderLabels: Record<PlayOrder, string> = {
  sequence: "顺序播放",
  reverse: "倒序播放",
  loop: "循环播放",
};

function readSavedVolume() {
  const saved = window.localStorage.getItem(PLAYER_VOLUME_KEY);
  if (saved === null) return 1;
  const value = Number(saved);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function readSavedMuted() {
  return window.localStorage.getItem(PLAYER_MUTED_KEY) === "true";
}

function readSavedBgmVolume() {
  const saved = window.localStorage.getItem(PLAYER_BGM_VOLUME_KEY);
  if (saved === null) return 0.4;
  const value = Number(saved);
  if (!Number.isFinite(value)) return 0.4;
  return Math.max(0, Math.min(1, value));
}

function readSavedPlayOrder(): PlayOrder {
  const saved = window.localStorage.getItem(PLAYER_ORDER_KEY);
  if (saved === "reverse" || saved === "loop") return saved;
  return "sequence";
}

function releaseMediaElement(element: HTMLMediaElement | null) {
  if (!element) return;

  try {
    element.muted = true;
    element.loop = false;
    element.pause();
  } catch {
    // Ignore media cleanup errors during webview shutdown.
  }

  try {
    if (element.srcObject && "getTracks" in element.srcObject) {
      element.srcObject.getTracks().forEach((track) => track.stop());
    }
    element.srcObject = null;
  } catch {
    // The player currently uses file URLs, but keep this safe for future media sources.
  }
}

export function VideoPlayerPage({ videoId }: { videoId: string }) {
  const switchLockedRef = useRef(false);
  const switchUnlockTimerRef = useRef<number | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const imageTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const releasedMediaElementsRef = useRef<WeakSet<HTMLMediaElement>>(
    new WeakSet(),
  );
  const [playlist, setPlaylist] = useState<VideoPlaylist | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [volume, setVolume] = useState(readSavedVolume);
  const [bgmVolume, setBgmVolume] = useState(readSavedBgmVolume);
  const [muted, setMuted] = useState(readSavedMuted);
  const [playOrder, setPlayOrder] = useState<PlayOrder>(readSavedPlayOrder);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [slideshowPaused, setSlideshowPaused] = useState(false);
  const [imageRemainingMs, setImageRemainingMs] = useState(0);
  const [slideshowCycle, setSlideshowCycle] = useState(0);
  const [bgmBlocked, setBgmBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearSwitchLockTimer = useCallback(() => {
    if (switchUnlockTimerRef.current === null) return;
    window.clearTimeout(switchUnlockTimerRef.current);
    switchUnlockTimerRef.current = null;
    switchLockedRef.current = false;
  }, []);

  const clearImageTimers = useCallback(() => {
    if (imageTimerRef.current !== null) {
      window.clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const releaseTrackedMediaElement = useCallback(
    (element: HTMLMediaElement | null) => {
      if (!element) return;
      releasedMediaElementsRef.current.add(element);
      releaseMediaElement(element);
    },
    [],
  );

  const cleanupPlayerResources = useCallback(() => {
    clearSwitchLockTimer();
    clearImageTimers();
    releaseTrackedMediaElement(videoRef.current);
    releaseTrackedMediaElement(bgmRef.current);
    videoRef.current = null;
    bgmRef.current = null;
    activeItemRef.current = null;
  }, [clearImageTimers, clearSwitchLockTimer, releaseTrackedMediaElement]);

  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      videoRef.current = node;
    }
  }, []);

  const setBgmElement = useCallback((node: HTMLAudioElement | null) => {
    bgmRef.current = node;
  }, []);

  const closePlayer = useCallback(() => {
    cleanupPlayerResources();
    const window = getCurrentWindow();
    void window.close().catch(() => window.destroy());
  }, [cleanupPlayerResources]);

  useEffect(() => {
    document.body.classList.add("player-window");
    return () => {
      cleanupPlayerResources();
      document.body.classList.remove("player-window");
    };
  }, [cleanupPlayerResources]);

  useEffect(() => {
    const handleShutdown = () => {
      cleanupPlayerResources();
    };
    let unlistenCloseRequested: (() => void) | null = null;

    window.addEventListener("pagehide", handleShutdown);
    window.addEventListener("beforeunload", handleShutdown);
    void getCurrentWindow()
      .onCloseRequested(() => {
        handleShutdown();
      })
      .then((unlisten) => {
        unlistenCloseRequested = unlisten;
      });

    return () => {
      window.removeEventListener("pagehide", handleShutdown);
      window.removeEventListener("beforeunload", handleShutdown);
      unlistenCloseRequested?.();
    };
  }, [cleanupPlayerResources]);

  useEffect(() => {
    let cancelled = false;
    if (!videoId) {
      setError("缺少视频 ID");
      return;
    }

    setError(null);
    void videoPlaylist(videoId)
      .then((nextPlaylist) => {
        if (cancelled) return;
        const initialIndex = Math.max(
          0,
          nextPlaylist.videos.findIndex(
            (item) => item.id === nextPlaylist.initialVideoId,
          ),
        );
        setPlaylist(nextPlaylist);
        setActiveIndex(initialIndex);
        setActiveMediaIndex(0);
        setSlideshowPaused(false);
      })
      .catch((requestError) => {
        if (!cancelled) setError(String(requestError));
      });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_MUTED_KEY, String(muted));
  }, [muted]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_BGM_VOLUME_KEY, String(bgmVolume));
  }, [bgmVolume]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_ORDER_KEY, playOrder);
  }, [playOrder]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PLAYER_VOLUME_KEY) {
        setVolume(readSavedVolume());
      }
      if (event.key === PLAYER_MUTED_KEY) {
        setMuted(readSavedMuted());
      }
      if (event.key === PLAYER_ORDER_KEY) {
        setPlayOrder(readSavedPlayOrder());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
    }
    if (bgmRef.current) {
      bgmRef.current.volume = bgmVolume;
      bgmRef.current.muted = muted;
    }
  }, [bgmVolume, muted, volume]);

  const activeVideo = useMemo(
    () => playlist?.videos[activeIndex] ?? null,
    [activeIndex, playlist],
  );
  const activeMedia = activeVideo?.media[activeMediaIndex] ?? null;

  useEffect(() => {
    setActiveMediaIndex(0);
    setBgmBlocked(false);
  }, [activeIndex]);

  const nextIndexForDirection = useCallback(
    (direction: 1 | -1) => {
      if (!playlist || playlist.videos.length <= 1) return activeIndex;

      const step = playOrder === "reverse" ? -direction : direction;
      const candidate = activeIndex + step;

      if (playOrder === "loop") {
        return (candidate + playlist.videos.length) % playlist.videos.length;
      }

      return Math.max(0, Math.min(playlist.videos.length - 1, candidate));
    },
    [activeIndex, playOrder, playlist],
  );

  const requestSwitchToIndex = useCallback(
    (nextIndex: number) => {
      if (!playlist) return;
      if (switchLockedRef.current) return;

      const boundedIndex = Math.max(
        0,
        Math.min(playlist.videos.length - 1, nextIndex),
      );
      if (boundedIndex === activeIndex) return;

      switchLockedRef.current = true;
      setError(null);
      setSlideshowPaused(false);
      setActiveIndex(boundedIndex);
      setActiveMediaIndex(0);
      switchUnlockTimerRef.current = window.setTimeout(() => {
        switchLockedRef.current = false;
        switchUnlockTimerRef.current = null;
      }, 700);
    },
    [activeIndex, playlist],
  );

  const switchToIndexManually = useCallback(
    (nextIndex: number) => {
      if (!playlist) return;

      const boundedIndex = Math.max(
        0,
        Math.min(playlist.videos.length - 1, nextIndex),
      );
      if (boundedIndex === activeIndex) return;

      setError(null);
      setSlideshowPaused(playlist.videos[boundedIndex]?.kind !== "video");
      setActiveIndex(boundedIndex);
      setActiveMediaIndex(0);
    },
    [activeIndex, playlist],
  );

  const switchMediaManually = useCallback(
    (nextIndex: number) => {
      if (!activeVideo) return;
      const boundedIndex = Math.max(
        0,
        Math.min(activeVideo.media.length - 1, nextIndex),
      );
      if (boundedIndex === activeMediaIndex) return;
      setSlideshowPaused(activeVideo.kind !== "video");
      setActiveMediaIndex(boundedIndex);
    },
    [activeMediaIndex, activeVideo],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!playlist || playlist.videos.length <= 1) return;
      if (Math.abs(event.deltaY) < 24) return;
      event.preventDefault();

      const direction = event.deltaY > 0 ? 1 : -1;
      const nextIndex = nextIndexForDirection(direction);
      if (nextIndex !== activeIndex) {
        switchToIndexManually(nextIndex);
      }
    },
    [activeIndex, nextIndexForDirection, playlist, switchToIndexManually],
  );

  const advanceAutomatically = useCallback(() => {
    if (!activeVideo || slideshowPaused) return;
    if (activeMediaIndex < activeVideo.media.length - 1) {
      setActiveMediaIndex((current) => current + 1);
      return;
    }
    if (playOrder === "loop") {
      if (activeMediaIndex === 0) {
        setSlideshowCycle((current) => current + 1);
      } else {
        setActiveMediaIndex(0);
      }
      return;
    }
    const nextIndex = nextIndexForDirection(1);
    if (nextIndex !== activeIndex) {
      requestSwitchToIndex(nextIndex);
    }
  }, [
    activeIndex,
    activeMediaIndex,
    activeVideo,
    nextIndexForDirection,
    playOrder,
    requestSwitchToIndex,
    slideshowPaused,
  ]);

  useEffect(() => {
    clearImageTimers();
    if (!activeMedia || activeMedia.kind !== "image") {
      setImageRemainingMs(0);
      return;
    }
    setImageRemainingMs(IMAGE_SLIDE_DURATION_MS);
    if (slideshowPaused) return;
    const startedAt = Date.now();
    imageTimerRef.current = window.setTimeout(
      advanceAutomatically,
      IMAGE_SLIDE_DURATION_MS,
    );
    countdownTimerRef.current = window.setInterval(() => {
      setImageRemainingMs(
        Math.max(0, IMAGE_SLIDE_DURATION_MS - (Date.now() - startedAt)),
      );
    }, 200);
    return clearImageTimers;
  }, [
    activeMedia,
    activeMediaIndex,
    advanceAutomatically,
    clearImageTimers,
    slideshowCycle,
    slideshowPaused,
  ]);

  const handleEnded = useCallback(
    (event: SyntheticEvent<HTMLMediaElement>) => {
      if (
        activeVideo?.kind === "video" &&
        activeVideo.media.length === 1 &&
        playOrder === "loop"
      ) {
        event.currentTarget.currentTime = 0;
        void event.currentTarget.play();
        return;
      }
      advanceAutomatically();
    },
    [activeVideo, advanceAutomatically, playOrder],
  );

  const applyPlaybackSettings = useCallback(
    (element: HTMLMediaElement) => {
      element.volume = volume;
      element.muted = muted;
      element.playbackRate = playbackRate;
    },
    [muted, playbackRate, volume],
  );

  const syncPlaybackSettings = useCallback((element: HTMLMediaElement) => {
    setVolume(element.volume);
    setMuted(element.muted);
    setPlaybackRate(element.playbackRate);
  }, []);

  const tryPlayBgm = useCallback(async () => {
    const element = bgmRef.current;
    if (!element) return;
    try {
      await element.play();
      setBgmBlocked(false);
    } catch {
      setBgmBlocked(true);
    }
  }, []);

  const resumeSlideshow = useCallback(() => {
    setSlideshowPaused(false);
    if (activeMedia?.kind === "video" && videoRef.current?.ended) {
      if (activeVideo && activeMediaIndex < activeVideo.media.length - 1) {
        setActiveMediaIndex((current) => current + 1);
      } else if (playOrder === "loop") {
        if (activeMediaIndex === 0) {
          setSlideshowCycle((current) => current + 1);
        } else {
          setActiveMediaIndex(0);
        }
      } else {
        const nextIndex = nextIndexForDirection(1);
        if (nextIndex !== activeIndex) {
          requestSwitchToIndex(nextIndex);
        }
      }
    }
  }, [
    activeIndex,
    activeMedia,
    activeMediaIndex,
    activeVideo,
    nextIndexForDirection,
    playOrder,
    requestSwitchToIndex,
  ]);

  const startWindowDrag = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      void getCurrentWindow().startDragging();
    },
    [],
  );

  if (!playlist || !activeVideo || !activeMedia) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <Spinner className="mr-2" />
        正在加载作品
      </div>
    );
  }

  return (
    <main className="player-root flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      {activeVideo.kind !== "video" && activeVideo.bgm && (
        <audio
          ref={setBgmElement}
          key={`bgm-${activeVideo.id}`}
          src={convertFileSrc(activeVideo.bgm.path)}
          autoPlay
          preload="auto"
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            element.volume = bgmVolume;
            element.muted = muted;
            const startSeconds = activeVideo.bgm
              ? activeVideo.bgm.startMs / 1000
              : 0;
            if (
              Number.isFinite(startSeconds) &&
              startSeconds > 0 &&
              startSeconds < element.duration
            ) {
              element.currentTime = startSeconds;
            }
            void element
              .play()
              .then(() => setBgmBlocked(false))
              .catch(() => setBgmBlocked(true));
          }}
          onTimeUpdate={(event) => {
            const bgm = activeVideo.bgm;
            if (!bgm || bgm.endMs <= bgm.startMs) return;
            if (event.currentTarget.currentTime * 1000 >= bgm.endMs) {
              event.currentTarget.currentTime = bgm.startMs / 1000;
              void event.currentTarget.play().catch(() => setBgmBlocked(true));
            }
          }}
          onEnded={(event) => {
            const bgm = activeVideo.bgm;
            event.currentTarget.currentTime = (bgm?.startMs || 0) / 1000;
            void event.currentTarget.play().catch(() => setBgmBlocked(true));
          }}
        />
      )}
      <div className="flex h-10 shrink-0 items-center justify-between bg-background px-3">
        <div
          className="flex min-w-0 flex-1 cursor-move items-center gap-1.5 text-muted-foreground"
          onMouseDown={startWindowDrag}
          onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
          data-tauri-drag-region
        >
          <GripHorizontal className="size-3.5" />
          <span className="truncate text-xs" data-tauri-drag-region>
            作品浏览
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="最小化"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <Minus data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="最大化"
            onClick={() => void getCurrentWindow().toggleMaximize()}
          >
            <Square data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="关闭"
            onClick={closePlayer}
          >
            <X data-icon="inline-start" />
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_340px] grid-rows-1">
        <section
          className="player-stage relative min-h-0 bg-foreground"
          onContextMenu={(event) => event.preventDefault()}
          onWheel={handleWheel}
        >
          {error ? (
            <div className="flex size-full items-center justify-center p-6">
              <Alert variant="destructive" className="max-w-xl">
                <AlertTriangle data-icon="inline-start" />
                <AlertTitle>无法播放作品</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : activeMedia.kind === "video" ? (
            <Player.Provider key={`${activeVideo.id}-${activeMediaIndex}`}>
              <VideoSkin
                className="douyin-video-player"
                poster={
                  activeVideo.coverPath
                    ? convertFileSrc(activeVideo.coverPath)
                    : undefined
                }
              >
                <Video
                  ref={setVideoElement}
                  key={`${activeVideo.id}-${activeMediaIndex}`}
                  src={convertFileSrc(activeMedia.path)}
                  autoPlay
                  preload="auto"
                  playsInline
                  loop={
                    activeVideo.kind === "video" &&
                    activeVideo.media.length === 1 &&
                    playOrder === "loop"
                  }
                  onLoadedMetadata={(event) => {
                    releasedMediaElementsRef.current.delete(
                      event.currentTarget,
                    );
                    setError(null);
                    applyPlaybackSettings(event.currentTarget);
                  }}
                  onVolumeChange={(event) => {
                    setVolume(event.currentTarget.volume);
                    setMuted(event.currentTarget.muted);
                  }}
                  onRateChange={(event) => {
                    setPlaybackRate(event.currentTarget.playbackRate);
                  }}
                  onEnded={handleEnded}
                  onPlay={(event) => {
                    syncPlaybackSettings(event.currentTarget);
                  }}
                  onError={(event) => {
                    if (
                      releasedMediaElementsRef.current.has(event.currentTarget)
                    )
                      return;
                    if (
                      !event.currentTarget.currentSrc &&
                      !event.currentTarget.getAttribute("src")
                    )
                      return;
                    const mediaError = event.currentTarget.error;
                    setError(mediaError?.message || "视频播放失败");
                  }}
                />
              </VideoSkin>
            </Player.Provider>
          ) : (
            <div className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-black p-2">
              <img
                key={`${activeVideo.id}-${activeMediaIndex}`}
                className="block h-auto max-h-full w-auto max-w-full shrink-0 object-contain"
                src={convertFileSrc(activeMedia.path)}
                alt={activeVideo.desc || "作品图片"}
                draggable={false}
                onLoad={() => setError(null)}
                onError={() => setError("图片加载失败")}
              />
            </div>
          )}
          {activeVideo.media.length > 1 && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full"
                disabled={activeMediaIndex === 0}
                onClick={() => switchMediaManually(activeMediaIndex - 1)}
                aria-label="上一个资源"
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full"
                disabled={activeMediaIndex === activeVideo.media.length - 1}
                onClick={() => switchMediaManually(activeMediaIndex + 1)}
                aria-label="下一个资源"
              >
                <ChevronRight />
              </Button>
            </>
          )}
          {activeVideo.kind !== "video" && (
            <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm">
              <span className="whitespace-nowrap">
                {activeMediaIndex + 1} / {activeVideo.media.length}
              </span>
              <span className="h-3 w-px bg-white/25" />
              {activeMedia.kind === "image" && !slideshowPaused && (
                <span className="whitespace-nowrap">
                  {Math.max(1, Math.ceil(imageRemainingMs / 1000))} 秒后切换
                </span>
              )}
              {activeMedia.kind === "video" && !slideshowPaused && (
                <span className="whitespace-nowrap">视频结束后继续</span>
              )}
              {slideshowPaused ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="h-6 rounded-full px-2 text-xs"
                  onClick={resumeSlideshow}
                >
                  <RotateCcw className="size-3" />
                  恢复轮播
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="h-6 rounded-full px-2 text-xs"
                  onClick={() => setSlideshowPaused(true)}
                >
                  <Pause className="size-3" />
                  暂停轮播
                </Button>
              )}
            </div>
          )}
          {activeVideo.kind !== "video" && activeVideo.bgm && (
            <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
              <Music2 className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {activeVideo.bgm.title || "作品背景音乐"}
              </span>
              <label
                className="ml-1 flex shrink-0 items-center gap-1.5"
                title={`BGM 音量 ${Math.round(bgmVolume * 100)}%`}
              >
                <span className="sr-only">BGM 音量</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(bgmVolume * 100)}
                  onChange={(event) =>
                    setBgmVolume(Number(event.target.value) / 100)
                  }
                  className="h-1.5 w-20 cursor-pointer accent-white"
                  aria-label="BGM 音量"
                />
                <span className="w-8 text-right tabular-nums text-white/80">
                  {Math.round(bgmVolume * 100)}%
                </span>
              </label>
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                className="ml-1 shrink-0 rounded-full"
                onClick={() => setMuted((current) => !current)}
                aria-label={muted ? "取消静音" : "静音"}
                title={muted ? "取消静音" : "静音"}
              >
                {muted ? (
                  <VolumeX className="size-3" />
                ) : (
                  <Volume2 className="size-3" />
                )}
              </Button>
              {bgmBlocked && (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="ml-1 h-6 shrink-0 rounded-full px-2 text-xs"
                  onClick={() => void tryPlayBgm()}
                >
                  <Play className="size-3" />
                  播放 BGM
                </Button>
              )}
            </div>
          )}
        </section>
        <aside className="flex min-h-0 min-w-0 flex-col border-t bg-background lg:border-l lg:border-t-0">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">作品列表</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                滚轮切换作品
              </p>
            </div>
            <Select
              value={playOrder}
              onValueChange={(value) => setPlayOrder(value as PlayOrder)}
            >
              <SelectTrigger size="sm" className="shrink-0">
                <SelectValue aria-label={playOrderLabels[playOrder]} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="sequence">顺序播放</SelectItem>
                  <SelectItem value="reverse">倒序播放</SelectItem>
                  <SelectItem value="loop">循环播放</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex flex-col gap-2">
              {playlist.videos.map((video, index) => (
                <PlaylistItem
                  key={video.id}
                  video={video}
                  active={index === activeIndex}
                  refSetter={
                    index === activeIndex
                      ? (node) => {
                          activeItemRef.current = node;
                        }
                      : undefined
                  }
                  onSelect={() => switchToIndexManually(index)}
                  onDelete={async () => {
                    try {
                      const deletedIndex = index;
                      await softDeleteVideo(video.id);
                      toast.success("作品已删除");

                      const newVideos = playlist.videos.filter((_, i) => i !== deletedIndex);
                      if (newVideos.length === 0) {
                        closePlayer();
                        return;
                      }

                      let newIndex: number;
                      if (playOrder === "reverse") {
                        newIndex = Math.max(0, deletedIndex - 1);
                      } else if (playOrder === "loop") {
                        newIndex = deletedIndex % newVideos.length;
                      } else {
                        newIndex = Math.min(deletedIndex, newVideos.length - 1);
                      }

                      setPlaylist({ ...playlist, videos: newVideos });
                      setActiveIndex(newIndex);
                      setActiveMediaIndex(0);
                      setSlideshowPaused(false);
                    } catch (error) {
                      toast.error(`删除作品失败：${String(error)}`);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function PlaylistItem({
  video,
  active,
  refSetter,
  onSelect,
  onDelete,
}: {
  video: VideoPlayerDetail;
  active: boolean;
  refSetter?: (node: HTMLDivElement | null) => void;
  onSelect: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <div
      ref={refSetter}
      className={cn(
        "group/item relative grid min-w-0 cursor-pointer grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-md border bg-background p-2 text-left transition-colors hover:bg-accent",
        active && "border-primary bg-accent",
      )}
      onClick={onSelect}
    >
      <div className="grid aspect-9/16 min-w-0 overflow-hidden rounded bg-muted">
        {video.coverPath ? (
          <img
            className="size-full object-cover"
            src={convertFileSrc(video.coverPath)}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="grid place-items-center text-muted-foreground">
            <ImageIcon className="size-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 self-center">
        <span className="block truncate text-xs text-muted-foreground">
          {new Date(video.createTime * 1000).toLocaleString()}
        </span>
        <p className="mt-1 line-clamp-3 text-sm font-medium leading-snug">
          {video.desc || "(无描述)"}
        </p>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {video.kind === "video" ? (
            <Play className="size-3" />
          ) : (
            <Images className="size-3" />
          )}
          {video.kind === "mixed"
            ? `图片与视频 · ${video.media.length} 项`
            : video.kind === "image"
              ? `${video.media.length} 张图片`
              : "视频"}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 z-10 size-7 opacity-0 transition-opacity group-hover/item:opacity-100"
        onClick={async (e) => {
          e.stopPropagation();
          await onDelete();
        }}
        aria-label="删除作品"
        title="删除作品"
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
