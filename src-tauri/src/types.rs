use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRecord {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub note: Option<String>,
    pub source: String,
    pub external_key: Option<String>,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRecord {
    pub id: String,
    pub url: String,
    pub sec_user_id: String,
    pub author_name: String,
    pub cookie_id: String,
    pub cookie_name: String,
    pub interval_minutes: i64,
    pub status: String,
    pub last_run_at: Option<String>,
    pub last_result: Option<String>,
    pub current_phase: Option<String>,
    pub current_downloaded: i64,
    pub current_total: i64,
    pub current_item: Option<String>,
    pub running_started_at: Option<String>,
    pub video_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorDetail {
    pub monitor: MonitorRecord,
    pub downloads_dir: String,
    pub user_downloads_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMonitorInput {
    pub url: String,
    pub cookie_id: String,
    pub interval_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMonitorInput {
    pub id: String,
    pub cookie_id: String,
    pub interval_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCookieInput {
    pub name: String,
    pub value: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCookieValueInput {
    pub id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSettings {
    pub endpoint: String,
    pub default_interval_minutes: i64,
    pub running: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBridgeSettingsInput {
    pub default_interval_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecord {
    pub id: String,
    pub sec_user_id: String,
    pub author_name: String,
    pub create_time: i64,
    pub aweme_id: String,
    pub desc: String,
    pub kind: String,
    pub status: String,
    pub video_path: String,
    pub manifest_path: String,
    pub cover_path: Option<String>,
    pub media: Vec<MediaAsset>,
    pub bgm: Option<AudioAsset>,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub kind: String,
    pub path: String,
    pub width: i64,
    pub height: i64,
    #[serde(default)]
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    pub path: String,
    pub title: String,
    pub author: String,
    pub duration_ms: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTreeUser {
    pub author_name: String,
    pub sec_user_id: String,
    pub dates: Vec<VideoTreeDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTreeDate {
    pub date: String,
    pub videos: Vec<VideoTreeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTreeItem {
    pub id: String,
    pub time: String,
    pub desc: String,
    pub kind: String,
    pub media_count: usize,
    pub status: String,
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlayerDetail {
    pub id: String,
    pub author_name: String,
    pub create_time: i64,
    pub desc: String,
    pub kind: String,
    pub status: String,
    pub video_path: String,
    pub cover_path: Option<String>,
    pub media: Vec<MediaAsset>,
    pub bgm: Option<AudioAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlaylist {
    pub sec_user_id: String,
    pub author_name: String,
    pub initial_video_id: String,
    pub videos: Vec<VideoPlayerDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(rename = "collectedAt")]
    pub collected_at: String,
    #[serde(rename = "secUserId")]
    pub sec_user_id: String,
    #[serde(rename = "authorName")]
    pub author_name: String,
    #[serde(rename = "totalPosts")]
    pub total_posts: usize,
    #[serde(rename = "videoPosts")]
    pub video_posts: usize,
    pub posts: Vec<CollectedPost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedPost {
    pub aweme_id: String,
    pub desc: String,
    pub author_name: String,
    pub create_time: Option<i64>,
    pub kind: String,
    pub raw: serde_json::Value,
    pub media: Vec<CollectedMedia>,
    pub bgm: Option<CollectedAudio>,
    pub video_candidates: Vec<VideoCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedMedia {
    pub kind: String,
    pub image_urls: Vec<String>,
    pub video_candidates: Vec<VideoCandidate>,
    pub width: i64,
    pub height: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedAudio {
    pub urls: Vec<String>,
    pub title: String,
    pub author: String,
    pub duration_ms: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCandidate {
    pub url: String,
    pub bit_rate: i64,
    pub data_size: i64,
    pub width: i64,
    pub height: i64,
    pub quality: Option<String>,
}
