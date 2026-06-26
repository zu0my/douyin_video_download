export type Page = "monitors" | "videos" | "cookies" | "ai";
export type MonitorStatus = "running" | "paused" | "error";
export type VideoStatus = "completed" | "downloading" | "failed" | "deleted";
export type WorkKind = "video" | "image" | "mixed";

export interface MediaAsset {
  kind: "video" | "image";
  path: string;
  width: number;
  height: number;
  durationMs: number;
}

export interface AudioAsset {
  path: string;
  title: string;
  author: string;
  durationMs: number;
  startMs: number;
  endMs: number;
}

export interface Monitor {
  id: string;
  url: string;
  secUserId: string;
  authorName: string;
  cookieId: string;
  cookieName: string;
  intervalMinutes: number;
  status: MonitorStatus;
  lastRunAt?: string;
  lastResult?: string;
  currentPhase?: string;
  currentDownloaded: number;
  currentTotal: number;
  currentItem?: string;
  runningStartedAt?: string;
  videoCount: number;
}

export interface MonitorDetail {
  monitor: Monitor;
  downloadsDir: string;
  userDownloadsDir: string;
}

export interface CookieRecord {
  id: string;
  name: string;
  updatedAt: string;
  note?: string;
  source: "manual" | "chrome";
  externalKey?: string;
  lastSyncedAt?: string;
}

export interface BridgeSettings {
  endpoint: string;
  defaultIntervalMinutes: number;
  running: boolean;
  error?: string;
}

export interface VideoTreeUser {
  authorName: string;
  secUserId: string;
  dates: Array<{
    date: string;
    videos: Array<{
      id: string;
      time: string;
      desc: string;
      kind: WorkKind;
      mediaCount: number;
      status: VideoStatus;
      coverPath?: string;
    }>;
  }>;
}

export interface VideoPlayerDetail {
  id: string;
  authorName: string;
  createTime: number;
  desc: string;
  kind: WorkKind;
  status: VideoStatus;
  videoPath: string;
  coverPath?: string;
  media: MediaAsset[];
  bgm?: AudioAsset | null;
}

export interface VideoPlaylist {
  secUserId: string;
  authorName: string;
  initialVideoId: string;
  videos: VideoPlayerDetail[];
}

export interface CreateMonitorInput {
  url: string;
  cookieId: string;
  intervalMinutes: number;
}

export interface UpdateMonitorInput {
  id: string;
  cookieId: string;
  intervalMinutes: number;
}

export interface CreateCookieInput {
  name: string;
  value: string;
  note?: string;
}
