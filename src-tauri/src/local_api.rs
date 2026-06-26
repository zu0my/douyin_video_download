use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::cookie_store;
use crate::douyin_client::extract_sec_user_id;
use crate::scheduler::Scheduler;
use crate::storage::Storage;

pub const BRIDGE_ENDPOINT: &str = "http://127.0.0.1:32145";
const BRIDGE_ADDRESS: &str = "127.0.0.1:32145";
const MAX_BODY_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Default)]
pub struct BridgeRunState {
    pub running: bool,
    pub error: Option<String>,
}

pub type SharedBridgeRunState = Arc<Mutex<BridgeRunState>>;

#[derive(Clone)]
struct ApiState {
    storage: Arc<Mutex<Storage>>,
    scheduler: Scheduler,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "ok": false,
                "error": self.message,
            })),
        )
            .into_response()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    app: &'static str,
    version: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    ok: bool,
    default_interval_minutes: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CookieSyncRequest {
    account_key: String,
    cookie_header: String,
    collected_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CookieSyncResponse {
    ok: bool,
    cookie_id: String,
    cookie_name: String,
    synced_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CookieRefreshQuery {
    account_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CookieRefreshResponse {
    ok: bool,
    refresh_needed: bool,
}

#[derive(Debug, Deserialize)]
struct MonitorStatusQuery {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorStatusResponse {
    ok: bool,
    monitored: bool,
    monitor_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMonitorRequest {
    url: String,
    account_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateMonitorResponse {
    ok: bool,
    status: &'static str,
    monitor_id: String,
    interval_minutes: i64,
}

pub async fn run(
    storage: Arc<Mutex<Storage>>,
    scheduler: Scheduler,
    runtime: SharedBridgeRunState,
) {
    let listener = match tokio::net::TcpListener::bind(BRIDGE_ADDRESS).await {
        Ok(listener) => listener,
        Err(error) => {
            let mut state = runtime.lock().await;
            state.running = false;
            state.error = Some(format!("无法监听 {BRIDGE_ADDRESS}：{error}"));
            return;
        }
    };

    {
        let mut state = runtime.lock().await;
        state.running = true;
        state.error = None;
    }

    let api_state = ApiState { storage, scheduler };
    let app = build_router(api_state);

    if let Err(error) = axum::serve(listener, app).await {
        let mut state = runtime.lock().await;
        state.running = false;
        state.error = Some(format!("本地桥接服务已停止：{error}"));
    }
}

fn build_router(api_state: ApiState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([CONTENT_TYPE]);
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/status", get(status))
        .route("/api/v1/cookies/sync", post(sync_cookie))
        .route("/api/v1/cookies/refresh-needed", get(cookie_refresh_needed))
        .route("/api/v1/monitors/status", get(get_monitor_status))
        .route("/api/v1/monitors", post(create_monitor))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(api_state)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        app: "Douyin Archive",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn status(State(state): State<ApiState>) -> Result<Json<StatusResponse>, ApiError> {
    let interval = state
        .storage
        .lock()
        .await
        .default_interval_minutes()
        .map_err(ApiError::internal)?;
    Ok(Json(StatusResponse {
        ok: true,
        default_interval_minutes: interval,
    }))
}

async fn sync_cookie(
    State(state): State<ApiState>,
    Json(input): Json<CookieSyncRequest>,
) -> Result<Json<CookieSyncResponse>, ApiError> {
    validate_identifier("accountKey", &input.account_key, 160)?;
    let cookie_header = input.cookie_header.trim();
    if cookie_header.is_empty() || !cookie_header.contains('=') {
        return Err(ApiError::bad_request("Cookie 内容无效"));
    }
    if cookie_header.len() > 96 * 1024 {
        return Err(ApiError::bad_request("Cookie 内容过大"));
    }
    validate_collected_at(&input.collected_at)?;
    let encrypted = cookie_store::encrypt_cookie(cookie_header).map_err(ApiError::internal)?;
    let (record, retry_ids) = {
        let storage = state.storage.lock().await;
        let record = storage
            .upsert_browser_cookie(input.account_key.trim(), &encrypted, &input.collected_at)
            .map_err(ApiError::internal)?;
        let _ = storage
            .consume_cookie_refresh_request(&record.id)
            .map_err(ApiError::internal)?;
        let retry_ids = storage
            .refresh_retry_monitor_ids(&record.id)
            .map_err(ApiError::internal)?;
        (record, retry_ids)
    };
    if !retry_ids.is_empty() {
        state
            .scheduler
            .retry_monitors(state.storage.clone(), retry_ids)
            .await;
    }
    Ok(Json(CookieSyncResponse {
        ok: true,
        cookie_id: record.id,
        cookie_name: record.name,
        synced_at: record.last_synced_at.unwrap_or(input.collected_at),
    }))
}

async fn cookie_refresh_needed(
    State(state): State<ApiState>,
    Query(query): Query<CookieRefreshQuery>,
) -> Result<Json<CookieRefreshResponse>, ApiError> {
    validate_identifier("accountKey", &query.account_key, 160)?;
    let refresh_needed = state
        .storage
        .lock()
        .await
        .cookie_refresh_needed(query.account_key.trim())
        .map_err(ApiError::internal)?;
    Ok(Json(CookieRefreshResponse {
        ok: true,
        refresh_needed,
    }))
}

async fn get_monitor_status(
    State(state): State<ApiState>,
    Query(query): Query<MonitorStatusQuery>,
) -> Result<Json<MonitorStatusResponse>, ApiError> {
    let sec_user_id = strict_sec_user_id(&query.url)?;
    let monitor = state
        .storage
        .lock()
        .await
        .active_monitor_by_sec_user_id(&sec_user_id)
        .map_err(ApiError::internal)?;
    Ok(Json(MonitorStatusResponse {
        ok: true,
        monitored: monitor.is_some(),
        monitor_id: monitor.map(|item| item.id),
    }))
}

async fn create_monitor(
    State(state): State<ApiState>,
    Json(input): Json<CreateMonitorRequest>,
) -> Result<Json<CreateMonitorResponse>, ApiError> {
    validate_identifier("accountKey", &input.account_key, 160)?;
    let sec_user_id = strict_sec_user_id(&input.url)?;
    let (monitor, created) = {
        let storage = state.storage.lock().await;
        if let Some(existing) = storage
            .active_monitor_by_sec_user_id(&sec_user_id)
            .map_err(ApiError::internal)?
        {
            (existing, false)
        } else {
            let cookie_id = storage
                .browser_cookie_id(input.account_key.trim())
                .map_err(ApiError::internal)?
                .ok_or_else(|| ApiError::not_found("尚未同步 Chrome Cookie"))?;
            let interval = storage
                .default_interval_minutes()
                .map_err(ApiError::internal)?;
            let monitor = storage
                .create_monitor(&input.url, &sec_user_id, &cookie_id, interval)
                .map_err(ApiError::internal)?;
            (monitor, true)
        }
    };
    if created {
        state
            .scheduler
            .start_monitor(
                state.storage.clone(),
                monitor.id.clone(),
                monitor.interval_minutes,
            )
            .await;
    }
    Ok(Json(CreateMonitorResponse {
        ok: true,
        status: if created { "created" } else { "already_exists" },
        monitor_id: monitor.id,
        interval_minutes: monitor.interval_minutes,
    }))
}

fn strict_sec_user_id(input: &str) -> Result<String, ApiError> {
    let url = reqwest::Url::parse(input.trim())
        .map_err(|_| ApiError::bad_request("必须提供完整的抖音用户主页 URL"))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "douyin.com" && !host.ends_with(".douyin.com") {
        return Err(ApiError::bad_request("仅支持 douyin.com 用户主页"));
    }
    let sec_user_id = extract_sec_user_id(url.as_str()).map_err(ApiError::internal)?;
    validate_identifier("secUserId", &sec_user_id, 512)?;
    Ok(sec_user_id)
}

fn validate_identifier(name: &str, value: &str, max: usize) -> Result<(), ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > max {
        return Err(ApiError::bad_request(format!("{name} 无效")));
    }
    if value.chars().any(|char| char.is_control()) {
        return Err(ApiError::bad_request(format!("{name} 包含非法字符")));
    }
    Ok(())
}

fn validate_collected_at(value: &str) -> Result<(), ApiError> {
    let collected = DateTime::parse_from_rfc3339(value)
        .map_err(|_| ApiError::bad_request("collectedAt 必须为 RFC3339 时间"))?
        .with_timezone(&Utc);
    if collected < Utc::now() - Duration::days(7) || collected > Utc::now() + Duration::minutes(10)
    {
        return Err(ApiError::bad_request("collectedAt 超出允许范围"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn only_accepts_douyin_user_pages() {
        assert_eq!(
            strict_sec_user_id("https://www.douyin.com/user/MS4wLjABAAAA").unwrap(),
            "MS4wLjABAAAA"
        );
        assert!(strict_sec_user_id("https://example.com/user/test").is_err());
        assert!(strict_sec_user_id("MS4wLjABAAAA").is_err());
    }

    #[tokio::test]
    async fn status_is_available_to_the_local_extension() {
        let dir = std::env::temp_dir().join(format!("douyin-api-{}", Uuid::new_v4()));
        let storage = Storage::open(dir.clone()).unwrap();
        let cookie = storage
            .upsert_browser_cookie("install:bridge", "v1:encrypted", "2026-06-26T00:00:00Z")
            .unwrap();
        storage
            .request_cookie_refresh(&cookie.id, "Cookie 可能失效")
            .unwrap();
        let state = ApiState {
            storage: Arc::new(Mutex::new(storage)),
            scheduler: Scheduler::new(),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, build_router(state)).await.unwrap();
        });
        let client = reqwest::Client::new();

        let health = client
            .get(format!("http://{address}/api/v1/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);

        let status = client
            .get(format!("http://{address}/api/v1/status"))
            .send()
            .await
            .unwrap();
        assert_eq!(status.status(), StatusCode::OK);
        let payload: serde_json::Value = status.json().await.unwrap();
        assert_eq!(payload["defaultIntervalMinutes"], 30);

        let refresh = client
            .get(format!(
                "http://{address}/api/v1/cookies/refresh-needed?accountKey=install%3Abridge"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(refresh.status(), StatusCode::OK);
        let payload: serde_json::Value = refresh.json().await.unwrap();
        assert_eq!(payload["refreshNeeded"], true);

        server.abort();
        let _ = std::fs::remove_dir_all(dir);
    }
}
