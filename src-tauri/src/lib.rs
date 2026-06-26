mod app_tray;
mod commands;
mod cookie_store;
mod douyin_client;
mod download_engine;
mod local_api;
mod scheduler;
mod storage;
mod types;

use std::path::PathBuf;
use std::sync::Arc;

use scheduler::Scheduler;
use storage::Storage;
use tauri::{Manager, State, WindowEvent};
use tokio::sync::Mutex;

pub struct AppState {
    pub storage: Arc<Mutex<Storage>>,
    pub scheduler: Scheduler,
    pub bridge_state: local_api::SharedBridgeRunState,
}

impl AppState {
    fn new() -> anyhow::Result<Self> {
        let base_dir = app_data_dir();
        std::fs::create_dir_all(&base_dir)?;
        let storage = Storage::open(base_dir)?;
        Ok(Self {
            storage: Arc::new(Mutex::new(storage)),
            scheduler: Scheduler::new(),
            bridge_state: Arc::new(Mutex::new(local_api::BridgeRunState::default())),
        })
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new().expect("failed to initialize app state"))
        .setup(|app| {
            app_tray::create_tray(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, AppState> = handle.state();
                let _ = state.scheduler.restore_enabled(state.storage.clone()).await;
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, AppState> = handle.state();
                local_api::run(
                    state.storage.clone(),
                    state.scheduler.clone(),
                    state.bridge_state.clone(),
                )
                .await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_monitors,
            commands::monitor_detail,
            commands::create_monitor,
            commands::update_monitor_settings,
            commands::pause_monitor,
            commands::resume_monitor,
            commands::delete_monitor,
            commands::run_monitor_now,
            commands::list_cookies,
            commands::create_cookie,
            commands::update_cookie_value,
            commands::delete_cookie,
            commands::bridge_settings,
            commands::update_bridge_settings,
            commands::list_video_tree,
            commands::video_playlist,
            commands::soft_delete_video,
            commands::restore_video,
            commands::soft_delete_user_videos,
            commands::soft_delete_all_videos,
            commands::cleanup_deleted_videos,
            commands::open_user_videos_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("douyin-video-download")
}
