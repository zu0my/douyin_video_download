use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::cookie_store;
use crate::douyin_client;
use crate::download_engine;
use crate::storage::Storage;

#[derive(Clone, Default)]
pub struct Scheduler {
    tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn restore_enabled(&self, storage: Arc<Mutex<Storage>>) -> anyhow::Result<()> {
        let monitors = storage.lock().await.enabled_monitors()?;
        for monitor in monitors {
            self.start_monitor(storage.clone(), monitor.id, monitor.interval_minutes)
                .await;
        }
        Ok(())
    }

    pub async fn start_monitor(
        &self,
        storage: Arc<Mutex<Storage>>,
        id: String,
        interval_minutes: i64,
    ) {
        self.stop_monitor(&id).await;
        let task_id = id.clone();
        let handle = tokio::spawn(async move {
            loop {
                let _ = run_monitor_once(storage.clone(), &task_id).await;
                tokio::time::sleep(Duration::from_secs((interval_minutes.max(1) * 60) as u64))
                    .await;
            }
        });
        self.tasks.lock().await.insert(id, handle);
    }

    pub async fn stop_monitor(&self, id: &str) {
        if let Some(handle) = self.tasks.lock().await.remove(id) {
            handle.abort();
        }
    }

    pub async fn retry_monitors(&self, storage: Arc<Mutex<Storage>>, monitor_ids: Vec<String>) {
        for id in monitor_ids {
            let storage = storage.clone();
            tokio::spawn(async move {
                let _ = run_monitor_once(storage, &id).await;
            });
        }
    }
}

pub async fn run_monitor_once(storage: Arc<Mutex<Storage>>, id: &str) -> anyhow::Result<usize> {
    let result = run_monitor_once_inner(storage.clone(), id).await;
    if let Err(error) = &result {
        record_monitor_failure(storage, id, error).await;
    }
    result
}

async fn run_monitor_once_inner(storage: Arc<Mutex<Storage>>, id: &str) -> anyhow::Result<usize> {
    let monitor = storage.lock().await.monitor_by_id(id)?;
    storage.lock().await.update_monitor_progress(
        id,
        "collecting",
        0,
        0,
        None,
        "正在采集视频列表",
    )?;
    let encrypted_cookie = storage
        .lock()
        .await
        .cookie_ciphertext(&monitor.cookie_id)?
        .ok_or_else(|| anyhow::anyhow!("Cookie 密文不存在，请到 Cookie 页面重填后再执行"))?;
    let cookie = cookie_store::decrypt_cookie(&encrypted_cookie).map_err(|error| {
        anyhow::anyhow!("Cookie 解密失败，请到 Cookie 页面重填后再执行：{error}")
    })?;
    let manifest = douyin_client::collect_user_posts(&monitor.sec_user_id, &cookie, None).await?;
    storage.lock().await.update_monitor_progress(
        id,
        "filtering",
        0,
        0,
        None,
        &format!("采集到 {} 个作品，正在筛选新增作品", manifest.video_posts),
    )?;
    let (downloads_dir, new_posts) = {
        let storage = storage.lock().await;
        let mut posts = Vec::new();
        for post in manifest.posts.iter().filter(|post| !post.media.is_empty()) {
            let Some(create_time) = post.create_time else {
                continue;
            };
            let media_kinds = post
                .media
                .iter()
                .map(|item| item.kind.clone())
                .collect::<Vec<_>>();
            if !storage.post_exists_active(
                &monitor.sec_user_id,
                create_time,
                &post.aweme_id,
                &post.kind,
                &media_kinds,
                post.bgm.is_some(),
            )? {
                posts.push(post.clone());
            }
        }
        (storage.downloads_dir(), posts)
    };
    let total = new_posts.len() as i64;
    storage.lock().await.update_monitor_progress(
        id,
        "downloading",
        0,
        total,
        None,
        &format!("发现 {total} 个新增作品"),
    )?;
    let downloaded_records = download_engine::download_posts_to_dir(
        &downloads_dir,
        &cookie,
        &monitor.sec_user_id,
        &new_posts,
    )
    .await?;
    let downloaded = downloaded_records.len();
    {
        let storage = storage.lock().await;
        for (index, video) in downloaded_records.iter().enumerate() {
            storage.upsert_video(video)?;
            let downloaded = (index + 1) as i64;
            storage.update_monitor_progress(
                id,
                "downloading",
                downloaded,
                total,
                Some(&video.desc),
                &format!("已下载 {downloaded}/{total} 个新增作品"),
            )?;
        }
    };
    let result = format!("新增下载 {downloaded} 个作品");
    storage
        .lock()
        .await
        .update_monitor_result(id, &manifest.author_name, "running", &result)?;
    Ok(downloaded)
}

async fn record_monitor_failure(storage: Arc<Mutex<Storage>>, id: &str, error: &anyhow::Error) {
    let storage = storage.lock().await;
    let Ok(monitor) = storage.monitor_by_id(id) else {
        return;
    };
    let cookie_error = douyin_client::is_probably_cookie_error(error);
    let result = if cookie_error {
        format!("Cookie 可能失效，等待 Chrome 插件同步后重试：{error}")
    } else {
        format!("监听执行失败：{error}")
    };
    let _ = storage.update_monitor_result(id, "", "error", &result);
    if cookie_error {
        let _ = storage.request_cookie_refresh(&monitor.cookie_id, &result);
    }
}
