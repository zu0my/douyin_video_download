import { invoke } from "@tauri-apps/api/core";
import type {
  BridgeSettings,
  CookieRecord,
  CreateCookieInput,
  CreateMonitorInput,
  Monitor,
  MonitorDetail,
  UpdateMonitorInput,
  VideoPlaylist,
  VideoTreeUser,
} from "@/types/app";

export async function listMonitors() {
  return invoke<Monitor[]>("list_monitors");
}

export async function monitorDetail(id: string) {
  return invoke<MonitorDetail>("monitor_detail", { id });
}

export async function createMonitor(input: CreateMonitorInput) {
  return invoke<Monitor>("create_monitor", { input });
}

export async function updateMonitorSettings(input: UpdateMonitorInput) {
  return invoke<Monitor>("update_monitor_settings", { input });
}

export async function runMonitorNow(id: string) {
  return invoke<number>("run_monitor_now", { id });
}

export async function pauseMonitor(id: string) {
  return invoke<void>("pause_monitor", { id });
}

export async function resumeMonitor(id: string) {
  return invoke<void>("resume_monitor", { id });
}

export async function deleteMonitor(id: string) {
  return invoke<void>("delete_monitor", { id });
}

export async function listCookies() {
  return invoke<CookieRecord[]>("list_cookies");
}

export async function createCookie(input: CreateCookieInput) {
  return invoke<CookieRecord>("create_cookie", { input });
}

export async function updateCookieValue(id: string, value: string) {
  return invoke<void>("update_cookie_value", { input: { id, value } });
}

export async function deleteCookie(id: string) {
  return invoke<void>("delete_cookie", { id });
}

export async function getBridgeSettings() {
  return invoke<BridgeSettings>("bridge_settings");
}

export async function updateBridgeSettings(defaultIntervalMinutes: number) {
  return invoke<void>("update_bridge_settings", {
    input: { defaultIntervalMinutes },
  });
}

export async function listVideoTree() {
  return invoke<VideoTreeUser[]>("list_video_tree");
}

export async function videoPlaylist(id: string) {
  return invoke<VideoPlaylist>("video_playlist", { id });
}

export async function softDeleteVideo(id: string) {
  return invoke<void>("soft_delete_video", { id });
}

export async function softDeleteUserVideos(secUserId: string) {
  return invoke<void>("soft_delete_user_videos", { secUserId });
}

export async function softDeleteAllVideos() {
  return invoke<void>("soft_delete_all_videos");
}

export async function openUserVideosFolder(secUserId: string) {
  return invoke<void>("open_user_videos_folder", { secUserId });
}
