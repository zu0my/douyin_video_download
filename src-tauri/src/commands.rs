use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::cookie_store;
use crate::douyin_client::extract_sec_user_id;
use crate::scheduler;
use crate::types::{
    BridgeSettings, CookieRecord, CreateCookieInput, CreateMonitorInput, MonitorDetail,
    MonitorRecord, UpdateBridgeSettingsInput, UpdateCookieValueInput, UpdateMonitorInput,
    VideoPlayerDetail, VideoPlaylist, VideoTreeUser,
};
use crate::AppState;

#[tauri::command]
pub async fn list_monitors(state: State<'_, AppState>) -> Result<Vec<MonitorRecord>, String> {
    state
        .storage
        .lock()
        .await
        .list_monitors()
        .map_err(to_string)
}

#[tauri::command]
pub async fn monitor_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<MonitorDetail, String> {
    let storage = state.storage.lock().await;
    let monitor = storage.monitor_by_id(&id).map_err(to_string)?;
    let downloads_dir = storage.downloads_dir();
    let user_downloads_dir = downloads_dir.join(&monitor.sec_user_id);
    Ok(MonitorDetail {
        monitor,
        downloads_dir: downloads_dir.to_string_lossy().to_string(),
        user_downloads_dir: user_downloads_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn create_monitor(
    state: State<'_, AppState>,
    input: CreateMonitorInput,
) -> Result<MonitorRecord, String> {
    if input.interval_minutes < 1 {
        return Err("监听间隔必须大于等于 1 分钟".to_string());
    }
    let sec_user_id = extract_sec_user_id(&input.url).map_err(to_string)?;
    let monitor = {
        let storage = state.storage.lock().await;
        if !storage.cookie_exists(&input.cookie_id).map_err(to_string)? {
            return Err("Cookie 不存在".to_string());
        }
        storage
            .create_monitor(
                &input.url,
                &sec_user_id,
                &input.cookie_id,
                input.interval_minutes,
            )
            .map_err(to_string)?
    };
    state
        .scheduler
        .start_monitor(
            state.storage.clone(),
            monitor.id.clone(),
            monitor.interval_minutes,
        )
        .await;
    Ok(monitor)
}

#[tauri::command]
pub async fn update_monitor_settings(
    state: State<'_, AppState>,
    input: UpdateMonitorInput,
) -> Result<MonitorRecord, String> {
    if input.interval_minutes < 1 {
        return Err("监听间隔必须大于等于 1 分钟".to_string());
    }
    let monitor = {
        let storage = state.storage.lock().await;
        if !storage.cookie_exists(&input.cookie_id).map_err(to_string)? {
            return Err("Cookie 不存在".to_string());
        }
        let before = storage.monitor_by_id(&input.id).map_err(to_string)?;
        let updated = storage
            .update_monitor_settings(&input.id, &input.cookie_id, input.interval_minutes)
            .map_err(to_string)?;
        (before, updated)
    };
    if monitor.0.status == "running" {
        state.scheduler.stop_monitor(&monitor.1.id).await;
        state
            .scheduler
            .start_monitor(
                state.storage.clone(),
                monitor.1.id.clone(),
                monitor.1.interval_minutes,
            )
            .await;
    }
    Ok(monitor.1)
}

#[tauri::command]
pub async fn pause_monitor(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.stop_monitor(&id).await;
    state
        .storage
        .lock()
        .await
        .set_monitor_status(&id, "paused")
        .map_err(to_string)
}

#[tauri::command]
pub async fn resume_monitor(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let monitor = {
        let storage = state.storage.lock().await;
        storage
            .set_monitor_status(&id, "running")
            .map_err(to_string)?;
        storage.monitor_by_id(&id).map_err(to_string)?
    };
    state
        .scheduler
        .start_monitor(state.storage.clone(), monitor.id, monitor.interval_minutes)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn delete_monitor(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.stop_monitor(&id).await;
    state
        .storage
        .lock()
        .await
        .delete_monitor(&id)
        .map_err(to_string)
}

#[tauri::command]
pub async fn run_monitor_now(state: State<'_, AppState>, id: String) -> Result<usize, String> {
    scheduler::run_monitor_once(state.storage.clone(), &id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_cookies(state: State<'_, AppState>) -> Result<Vec<CookieRecord>, String> {
    state.storage.lock().await.list_cookies().map_err(to_string)
}

#[tauri::command]
pub async fn create_cookie(
    state: State<'_, AppState>,
    input: CreateCookieInput,
) -> Result<CookieRecord, String> {
    let encrypted = cookie_store::encrypt_cookie(&input.value)
        .map_err(|error| format!("加密 Cookie 失败：{error}"))?;
    let record = state
        .storage
        .lock()
        .await
        .create_cookie(&input.name, input.note.as_deref(), &encrypted)
        .map_err(to_string)?;
    Ok(record)
}

#[tauri::command]
pub async fn update_cookie_value(
    state: State<'_, AppState>,
    input: UpdateCookieValueInput,
) -> Result<(), String> {
    {
        let storage = state.storage.lock().await;
        if !storage.cookie_exists(&input.id).map_err(to_string)? {
            return Err("Cookie 记录不存在".to_string());
        }
    }
    let encrypted = cookie_store::encrypt_cookie(&input.value)
        .map_err(|error| format!("加密 Cookie 失败：{error}"))?;
    state
        .storage
        .lock()
        .await
        .update_cookie_secret(&input.id, &encrypted)
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_cookie(state: State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let storage = state.storage.lock().await;
        let monitor_count = storage
            .active_monitor_count_for_cookie(&id)
            .map_err(to_string)?;
        if monitor_count > 0 {
            return Err(format!(
                "该 Cookie 正被 {monitor_count} 个监听使用，请先删除或更换这些监听"
            ));
        }
    }
    state
        .storage
        .lock()
        .await
        .delete_cookie(&id)
        .map_err(to_string)
}

#[tauri::command]
pub async fn bridge_settings(state: State<'_, AppState>) -> Result<BridgeSettings, String> {
    let default_interval_minutes = {
        let storage = state.storage.lock().await;
        storage.default_interval_minutes().map_err(to_string)?
    };
    let runtime = state.bridge_state.lock().await.clone();
    Ok(BridgeSettings {
        endpoint: crate::local_api::BRIDGE_ENDPOINT.to_string(),
        default_interval_minutes,
        running: runtime.running,
        error: runtime.error,
    })
}

#[tauri::command]
pub async fn update_bridge_settings(
    state: State<'_, AppState>,
    input: UpdateBridgeSettingsInput,
) -> Result<(), String> {
    if input.default_interval_minutes < 1 {
        return Err("默认监听间隔必须大于等于 1 分钟".to_string());
    }
    state
        .storage
        .lock()
        .await
        .set_setting(
            "default_interval_minutes",
            &input.default_interval_minutes.to_string(),
        )
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_video_tree(state: State<'_, AppState>) -> Result<Vec<VideoTreeUser>, String> {
    state
        .storage
        .lock()
        .await
        .list_video_tree()
        .map_err(to_string)
}

#[tauri::command]
pub async fn video_playlist(
    state: State<'_, AppState>,
    id: String,
) -> Result<VideoPlaylist, String> {
    let storage = state.storage.lock().await;
    let initial_video = storage.video_by_id(&id).map_err(to_string)?;
    if initial_video.deleted_at.is_some() || initial_video.status == "deleted" {
        return Err("作品已删除，无法浏览".to_string());
    }
    if initial_video.status != "completed" {
        return Err(format!("作品状态为 {}，尚不可浏览", initial_video.status));
    }
    let videos = storage
        .list_playable_videos_for_user(&initial_video.sec_user_id)
        .map_err(to_string)?
        .into_iter()
        .filter_map(|mut video| {
            video
                .media
                .retain(|asset| PathBuf::from(&asset.path).exists());
            if video.media.is_empty() {
                return None;
            }
            Some(VideoPlayerDetail {
                id: video.id,
                author_name: video.author_name,
                create_time: video.create_time,
                desc: video.desc,
                kind: video.kind,
                status: video.status,
                video_path: video.video_path,
                cover_path: video.cover_path,
                media: video.media,
                bgm: video.bgm.filter(|bgm| PathBuf::from(&bgm.path).exists()),
            })
        })
        .collect::<Vec<_>>();
    if videos.is_empty() {
        return Err("该用户没有可浏览作品".to_string());
    }
    Ok(VideoPlaylist {
        sec_user_id: initial_video.sec_user_id,
        author_name: initial_video.author_name,
        initial_video_id: id,
        videos,
    })
}

#[tauri::command]
pub async fn soft_delete_video(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let storage = state.storage.lock().await;
    let video = storage.video_by_id(&id).map_err(to_string)?;
    move_video_files_to_trash(storage.base_dir(), &video).map_err(to_string)?;
    storage.mark_video_deleted(&id).map_err(to_string)
}

#[tauri::command]
pub async fn restore_video(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let storage = state.storage.lock().await;
    let video = storage.video_by_id(&id).map_err(to_string)?;
    restore_video_files(storage.base_dir(), &video).map_err(to_string)?;
    storage.restore_video(&id).map_err(to_string)
}

#[tauri::command]
pub async fn soft_delete_user_videos(
    state: State<'_, AppState>,
    sec_user_id: String,
) -> Result<(), String> {
    let storage = state.storage.lock().await;
    for video in storage
        .list_videos(false)
        .map_err(to_string)?
        .into_iter()
        .filter(|item| item.sec_user_id == sec_user_id)
    {
        move_video_files_to_trash(storage.base_dir(), &video).map_err(to_string)?;
        storage.mark_video_deleted(&video.id).map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn soft_delete_all_videos(state: State<'_, AppState>) -> Result<(), String> {
    let storage = state.storage.lock().await;
    for video in storage.list_videos(false).map_err(to_string)? {
        move_video_files_to_trash(storage.base_dir(), &video).map_err(to_string)?;
        storage.mark_video_deleted(&video.id).map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cleanup_deleted_videos(state: State<'_, AppState>) -> Result<usize, String> {
    let storage = state.storage.lock().await;
    let videos = storage.deleted_videos_older_than(7).map_err(to_string)?;
    let count = videos.len();
    for video in videos {
        let trash_dir = storage.base_dir().join("trash").join(&video.id);
        let _ = fs::remove_dir_all(trash_dir);
        storage.purge_video(&video.id).map_err(to_string)?;
    }
    Ok(count)
}

#[tauri::command]
pub async fn open_user_videos_folder(
    state: State<'_, AppState>,
    sec_user_id: String,
) -> Result<(), String> {
    let storage = state.storage.lock().await;
    let downloads_dir = storage.downloads_dir();
    let user_dir = downloads_dir.join(&sec_user_id);

    if !user_dir.exists() {
        return Err("作品文件夹不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(user_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(user_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(user_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn move_video_files_to_trash(
    base_dir: &Path,
    video: &crate::types::VideoRecord,
) -> anyhow::Result<()> {
    let trash_dir = base_dir.join("trash").join(&video.id);
    fs::create_dir_all(&trash_dir)?;
    for path in video_file_paths(video) {
        move_file(&path, &trash_dir)?;
    }
    Ok(())
}

fn restore_video_files(base_dir: &Path, video: &crate::types::VideoRecord) -> anyhow::Result<()> {
    let trash_dir = base_dir.join("trash").join(&video.id);
    for path in video_file_paths(video) {
        restore_file(&trash_dir, &path)?;
    }
    let _ = fs::remove_dir(&trash_dir);
    Ok(())
}

fn video_file_paths(video: &crate::types::VideoRecord) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for path in video
        .media
        .iter()
        .map(|asset| asset.path.as_str())
        .chain(std::iter::once(video.video_path.as_str()))
        .chain(std::iter::once(video.manifest_path.as_str()))
        .chain(video.cover_path.as_deref())
        .chain(video.bgm.as_ref().map(|bgm| bgm.path.as_str()))
    {
        if !path.trim().is_empty() && seen.insert(path.to_string()) {
            paths.push(path.to_string());
        }
    }
    paths
}

fn move_file(path: &str, trash_dir: &Path) -> anyhow::Result<()> {
    let source = PathBuf::from(path);
    if source.exists() {
        let file_name = source
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("missing file name"))?;
        fs::rename(&source, trash_dir.join(file_name))?;
    }
    Ok(())
}

fn restore_file(trash_dir: &Path, path: &str) -> anyhow::Result<()> {
    let target = PathBuf::from(path);
    let file_name = target
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("missing file name"))?;
    let source = trash_dir.join(file_name);
    if source.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(source, target)?;
    }
    Ok(())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
