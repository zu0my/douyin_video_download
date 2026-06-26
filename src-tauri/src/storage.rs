use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Duration, Local, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::types::{
    AudioAsset, CookieRecord, MediaAsset, MonitorRecord, VideoRecord, VideoTreeDate, VideoTreeItem,
    VideoTreeUser,
};

pub struct Storage {
    conn: Connection,
    base_dir: PathBuf,
}

impl Storage {
    pub fn open(base_dir: PathBuf) -> anyhow::Result<Self> {
        fs::create_dir_all(base_dir.join("downloads"))?;
        fs::create_dir_all(base_dir.join("trash"))?;
        let conn = Connection::open(base_dir.join("app.db"))?;
        let storage = Self { conn, base_dir };
        storage.initialize_schema()?;
        Ok(storage)
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    pub fn downloads_dir(&self) -> PathBuf {
        self.base_dir.join("downloads")
    }

    fn initialize_schema(&self) -> anyhow::Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS cookies (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              note TEXT,
              cookie_ciphertext TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'manual',
              external_key TEXT,
              last_synced_at TEXT,
              refresh_requested_at TEXT,
              refresh_reason TEXT,
              last_refresh_attempt_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS monitors (
              id TEXT PRIMARY KEY,
              url TEXT NOT NULL,
              sec_user_id TEXT NOT NULL,
              author_name TEXT NOT NULL DEFAULT '',
              cookie_id TEXT NOT NULL,
              interval_minutes INTEGER NOT NULL,
              status TEXT NOT NULL,
              last_run_at TEXT,
              last_result TEXT,
              current_phase TEXT,
              current_downloaded INTEGER NOT NULL DEFAULT 0,
              current_total INTEGER NOT NULL DEFAULT 0,
              current_item TEXT,
              running_started_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE TABLE IF NOT EXISTS videos (
              id TEXT PRIMARY KEY,
              sec_user_id TEXT NOT NULL,
              author_name TEXT NOT NULL,
              create_time INTEGER NOT NULL,
              aweme_id TEXT NOT NULL,
              desc TEXT NOT NULL,
              kind TEXT NOT NULL DEFAULT 'video',
              status TEXT NOT NULL,
              video_path TEXT NOT NULL,
              manifest_path TEXT NOT NULL,
              cover_path TEXT,
              media_json TEXT NOT NULL DEFAULT '[]',
              bgm_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              UNIQUE(sec_user_id, create_time),
              UNIQUE(sec_user_id, aweme_id)
            );
            "#,
        )?;
        self.conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS cookies_source_external_key
             ON cookies(source, external_key) WHERE external_key IS NOT NULL",
            [],
        )?;
        for (column, definition) in [
            ("refresh_requested_at", "TEXT"),
            ("refresh_reason", "TEXT"),
            ("last_refresh_attempt_at", "TEXT"),
        ] {
            if !self.column_exists("cookies", column)? {
                self.conn.execute(
                    &format!("ALTER TABLE cookies ADD COLUMN {column} {definition}"),
                    [],
                )?;
            }
        }
        Ok(())
    }

    fn column_exists(&self, table: &str, column: &str) -> anyhow::Result<bool> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for item in columns {
            if item? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn create_cookie(
        &self,
        name: &str,
        note: Option<&str>,
        cookie_ciphertext: &str,
    ) -> anyhow::Result<CookieRecord> {
        let now = now();
        let id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO cookies (id, name, note, cookie_ciphertext, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, note, cookie_ciphertext, now],
        )?;
        Ok(CookieRecord {
            id,
            name: name.to_string(),
            note: note.map(str::to_string),
            updated_at: now,
            source: "manual".to_string(),
            external_key: None,
            last_synced_at: None,
        })
    }

    pub fn update_cookie_secret(&self, id: &str, cookie_ciphertext: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE cookies SET cookie_ciphertext = ?1, updated_at = ?2 WHERE id = ?3",
            params![cookie_ciphertext, now(), id],
        )?;
        Ok(())
    }

    pub fn cookie_ciphertext(&self, id: &str) -> anyhow::Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT cookie_ciphertext FROM cookies WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn active_monitor_count_for_cookie(&self, id: &str) -> anyhow::Result<i64> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM monitors WHERE cookie_id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn list_cookies(&self) -> anyhow::Result<Vec<CookieRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, note, updated_at, source, external_key, last_synced_at
             FROM cookies ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], cookie_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn upsert_browser_cookie(
        &self,
        account_key: &str,
        cookie_ciphertext: &str,
        collected_at: &str,
    ) -> anyhow::Result<CookieRecord> {
        let target_key = account_key;
        let name = "Chrome 自动同步";
        let note = "由 Chrome 插件自动同步";
        let target_id = self.external_cookie_id("chrome", target_key)?;

        let id = if let Some(target_id) = target_id {
            target_id
        } else {
            let id = Uuid::new_v4().to_string();
            let current = now();
            self.conn.execute(
                "INSERT INTO cookies
                 (id, name, note, cookie_ciphertext, source, external_key, last_synced_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'chrome', ?5, ?6, ?7, ?7)",
                params![
                    id,
                    name,
                    note,
                    cookie_ciphertext,
                    target_key,
                    collected_at,
                    current
                ],
            )?;
            return self.cookie_by_id(&id);
        };

        self.conn.execute(
            "UPDATE cookies SET name = ?1, note = ?2, cookie_ciphertext = ?3,
             last_synced_at = ?4, updated_at = ?5 WHERE id = ?6",
            params![name, note, cookie_ciphertext, collected_at, now(), id],
        )?;
        self.cookie_by_id(&id)
    }

    pub fn browser_cookie_id(&self, account_key: &str) -> anyhow::Result<Option<String>> {
        self.external_cookie_id("chrome", account_key)
    }

    pub fn request_cookie_refresh(&self, cookie_id: &str, reason: &str) -> anyhow::Result<bool> {
        let cutoff = (Utc::now() - Duration::minutes(15)).to_rfc3339();
        let changed = self.conn.execute(
            "UPDATE cookies
             SET refresh_requested_at = ?1, refresh_reason = ?2, updated_at = ?1
             WHERE id = ?3 AND source = 'chrome'
               AND refresh_requested_at IS NULL
               AND (last_refresh_attempt_at IS NULL OR last_refresh_attempt_at < ?4)",
            params![now(), reason, cookie_id, cutoff],
        )?;
        Ok(changed > 0)
    }

    pub fn cookie_refresh_needed(&self, account_key: &str) -> anyhow::Result<bool> {
        self.conn
            .query_row(
                "SELECT refresh_requested_at IS NOT NULL
                 FROM cookies WHERE source = 'chrome' AND external_key = ?1",
                params![account_key],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(Into::into)
    }

    pub fn consume_cookie_refresh_request(&self, cookie_id: &str) -> anyhow::Result<bool> {
        let pending = self
            .conn
            .query_row(
                "SELECT refresh_requested_at IS NOT NULL FROM cookies WHERE id = ?1",
                params![cookie_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(false);
        if pending {
            self.conn.execute(
                "UPDATE cookies
                 SET refresh_requested_at = NULL, refresh_reason = NULL,
                     last_refresh_attempt_at = ?1, updated_at = ?1
                 WHERE id = ?2",
                params![now(), cookie_id],
            )?;
        }
        Ok(pending)
    }

    pub fn refresh_retry_monitor_ids(&self, cookie_id: &str) -> anyhow::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM monitors
             WHERE cookie_id = ?1 AND deleted_at IS NULL AND status = 'error'
               AND last_result LIKE 'Cookie 可能失效%'",
        )?;
        let rows = stmt.query_map(params![cookie_id], |row| row.get(0))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn external_cookie_id(
        &self,
        source: &str,
        external_key: &str,
    ) -> anyhow::Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT id FROM cookies WHERE source = ?1 AND external_key = ?2",
                params![source, external_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    fn cookie_by_id(&self, id: &str) -> anyhow::Result<CookieRecord> {
        self.conn
            .query_row(
                "SELECT id, name, note, updated_at, source, external_key, last_synced_at
                 FROM cookies WHERE id = ?1",
                params![id],
                cookie_from_row,
            )
            .map_err(Into::into)
    }

    pub fn setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now()],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> anyhow::Result<()> {
        self.conn
            .execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn default_interval_minutes(&self) -> anyhow::Result<i64> {
        Ok(self
            .setting("default_interval_minutes")?
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value >= 1)
            .unwrap_or(30))
    }

    pub fn active_monitor_by_sec_user_id(
        &self,
        sec_user_id: &str,
    ) -> anyhow::Result<Option<MonitorRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT m.id, m.url, m.sec_user_id, m.author_name, m.cookie_id, c.name, m.interval_minutes,
                       m.status, m.last_run_at, m.last_result, m.current_phase, m.current_downloaded,
                       m.current_total, m.current_item, m.running_started_at,
                       (SELECT COUNT(*) FROM videos v WHERE v.sec_user_id = m.sec_user_id AND v.deleted_at IS NULL)
                FROM monitors m
                JOIN cookies c ON c.id = m.cookie_id
                WHERE m.sec_user_id = ?1 AND m.deleted_at IS NULL
                ORDER BY m.created_at DESC LIMIT 1
                "#,
                params![sec_user_id],
                monitor_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_cookie(&self, id: &str) -> anyhow::Result<()> {
        self.conn
            .execute("DELETE FROM cookies WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn cookie_exists(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM cookies WHERE id = ?1", params![id], |_| {
                Ok(())
            })
            .optional()?
            .is_some())
    }

    pub fn create_monitor(
        &self,
        url: &str,
        sec_user_id: &str,
        cookie_id: &str,
        interval_minutes: i64,
    ) -> anyhow::Result<MonitorRecord> {
        let now = now();
        let id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO monitors (id, url, sec_user_id, cookie_id, interval_minutes, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6)",
            params![id, url, sec_user_id, cookie_id, interval_minutes, now],
        )?;
        self.monitor_by_id(&id)
    }

    pub fn list_monitors(&self) -> anyhow::Result<Vec<MonitorRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT m.id, m.url, m.sec_user_id, m.author_name, m.cookie_id, c.name, m.interval_minutes,
                   m.status, m.last_run_at, m.last_result, m.current_phase, m.current_downloaded,
                   m.current_total, m.current_item, m.running_started_at,
                   (SELECT COUNT(*) FROM videos v WHERE v.sec_user_id = m.sec_user_id AND v.deleted_at IS NULL)
            FROM monitors m
            JOIN cookies c ON c.id = m.cookie_id
            WHERE m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], monitor_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn enabled_monitors(&self) -> anyhow::Result<Vec<MonitorRecord>> {
        Ok(self
            .list_monitors()?
            .into_iter()
            .filter(|item| item.status == "running")
            .collect())
    }

    pub fn monitor_by_id(&self, id: &str) -> anyhow::Result<MonitorRecord> {
        self.conn.query_row(
            r#"
            SELECT m.id, m.url, m.sec_user_id, m.author_name, m.cookie_id, c.name, m.interval_minutes,
                   m.status, m.last_run_at, m.last_result, m.current_phase, m.current_downloaded,
                   m.current_total, m.current_item, m.running_started_at,
                   (SELECT COUNT(*) FROM videos v WHERE v.sec_user_id = m.sec_user_id AND v.deleted_at IS NULL)
            FROM monitors m
            JOIN cookies c ON c.id = m.cookie_id
            WHERE m.id = ?1 AND m.deleted_at IS NULL
            "#,
            params![id],
            monitor_from_row,
        ).map_err(Into::into)
    }

    pub fn set_monitor_status(&self, id: &str, status: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE monitors SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now(), id],
        )?;
        Ok(())
    }

    pub fn update_monitor_settings(
        &self,
        id: &str,
        cookie_id: &str,
        interval_minutes: i64,
    ) -> anyhow::Result<MonitorRecord> {
        self.conn.execute(
            "UPDATE monitors SET cookie_id = ?1, interval_minutes = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
            params![cookie_id, interval_minutes, now(), id],
        )?;
        self.monitor_by_id(id)
    }

    pub fn delete_monitor(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE monitors SET deleted_at = ?1, status = 'paused' WHERE id = ?2",
            params![now(), id],
        )?;
        Ok(())
    }

    pub fn update_monitor_result(
        &self,
        id: &str,
        author_name: &str,
        status: &str,
        result: &str,
    ) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE monitors SET author_name = CASE WHEN ?1 = '' THEN author_name ELSE ?1 END, status = ?2, last_run_at = ?3, last_result = ?4, current_phase = NULL, current_item = NULL, running_started_at = NULL, updated_at = ?3 WHERE id = ?5",
            params![author_name, status, now(), result, id],
        )?;
        Ok(())
    }

    pub fn update_monitor_progress(
        &self,
        id: &str,
        phase: &str,
        downloaded: i64,
        total: i64,
        item: Option<&str>,
        result: &str,
    ) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE monitors SET current_phase = ?1, current_downloaded = ?2, current_total = ?3, current_item = ?4, running_started_at = COALESCE(running_started_at, ?5), last_run_at = ?5, last_result = ?6, updated_at = ?5 WHERE id = ?7",
            params![phase, downloaded, total, item, now(), result, id],
        )?;
        Ok(())
    }

    pub fn post_exists_active(
        &self,
        sec_user_id: &str,
        create_time: i64,
        aweme_id: &str,
        kind: &str,
        media_kinds: &[String],
        expects_bgm: bool,
    ) -> anyhow::Result<bool> {
        let existing = self
            .conn
            .query_row(
                "SELECT kind, media_json, bgm_json FROM videos
                 WHERE sec_user_id = ?1 AND (create_time = ?2 OR aweme_id = ?3)
                   AND deleted_at IS NULL",
                params![sec_user_id, create_time, aweme_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((existing_kind, media_json, bgm_json)) = existing else {
            return Ok(false);
        };
        let media_complete = serde_json::from_str::<Vec<MediaAsset>>(&media_json)
            .ok()
            .is_some_and(|assets| {
                !assets.is_empty()
                    && assets
                        .iter()
                        .map(|asset| &asset.kind)
                        .eq(media_kinds.iter())
                    && assets.iter().all(|asset| Path::new(&asset.path).is_file())
            });
        let bgm_complete = if expects_bgm {
            bgm_json
                .as_deref()
                .and_then(|json| serde_json::from_str::<AudioAsset>(json).ok())
                .is_some_and(|bgm| PathBuf::from(bgm.path).exists())
        } else {
            true
        };
        Ok(existing_kind == kind && media_complete && bgm_complete)
    }

    pub fn upsert_video(&self, video: &VideoRecord) -> anyhow::Result<()> {
        let now = now();
        self.conn.execute(
            r#"
            INSERT INTO videos (id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
            ON CONFLICT(sec_user_id, create_time) DO UPDATE SET
              author_name = excluded.author_name,
              aweme_id = excluded.aweme_id,
              desc = excluded.desc,
              kind = excluded.kind,
              status = excluded.status,
              video_path = excluded.video_path,
              manifest_path = excluded.manifest_path,
              cover_path = excluded.cover_path,
              media_json = excluded.media_json,
              bgm_json = excluded.bgm_json,
              updated_at = excluded.updated_at,
              deleted_at = NULL
            ON CONFLICT(sec_user_id, aweme_id) DO UPDATE SET
              author_name = excluded.author_name,
              create_time = excluded.create_time,
              desc = excluded.desc,
              kind = excluded.kind,
              status = excluded.status,
              video_path = excluded.video_path,
              manifest_path = excluded.manifest_path,
              cover_path = excluded.cover_path,
              media_json = excluded.media_json,
              bgm_json = excluded.bgm_json,
              updated_at = excluded.updated_at,
              deleted_at = NULL
            "#,
            params![
                video.id,
                video.sec_user_id,
                video.author_name,
                video.create_time,
                video.aweme_id,
                video.desc,
                video.kind,
                video.status,
                video.video_path,
                video.manifest_path,
                video.cover_path,
                serde_json::to_string(&video.media)?,
                video
                    .bgm
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                now
            ],
        )?;
        Ok(())
    }

    pub fn list_video_tree(&self) -> anyhow::Result<Vec<VideoTreeUser>> {
        let videos = self.list_videos(false)?;
        let monitor_names = self.monitor_author_names()?;
        let mut users: BTreeMap<String, BTreeMap<String, Vec<VideoTreeItem>>> = BTreeMap::new();
        let mut fallback_names: HashMap<String, String> = HashMap::new();
        for video in videos {
            let dt = Local
                .timestamp_opt(video.create_time, 0)
                .single()
                .unwrap_or_else(Local::now);
            let date = dt.format("%Y-%m-%d").to_string();
            let time = dt.format("%H:%M").to_string();
            fallback_names
                .entry(video.sec_user_id.clone())
                .or_insert_with(|| video.author_name.clone());
            users
                .entry(video.sec_user_id.clone())
                .or_default()
                .entry(date)
                .or_default()
                .push(VideoTreeItem {
                    id: video.id,
                    time,
                    desc: video.desc,
                    kind: video.kind,
                    media_count: video.media.len(),
                    status: video.status,
                    cover_path: video.cover_path,
                });
        }
        Ok(users
            .into_iter()
            .map(|(sec_user_id, dates)| {
                let author_name = monitor_names
                    .get(&sec_user_id)
                    .filter(|name| !name.trim().is_empty())
                    .or_else(|| {
                        fallback_names
                            .get(&sec_user_id)
                            .filter(|name| !name.trim().is_empty())
                    })
                    .cloned()
                    .unwrap_or_else(|| sec_user_id.clone());
                VideoTreeUser {
                    sec_user_id,
                    author_name,
                    dates: dates
                        .into_iter()
                        .rev()
                        .map(|(date, mut videos)| {
                            videos.sort_by(|a, b| b.time.cmp(&a.time));
                            VideoTreeDate { date, videos }
                        })
                        .collect(),
                }
            })
            .collect())
    }

    fn monitor_author_names(&self) -> anyhow::Result<HashMap<String, String>> {
        let mut stmt = self.conn.prepare(
            "SELECT sec_user_id, author_name FROM monitors WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut names = HashMap::new();
        for row in rows {
            let (sec_user_id, author_name) = row?;
            names.entry(sec_user_id).or_insert(author_name);
        }
        Ok(names)
    }

    pub fn list_videos(&self, include_deleted: bool) -> anyhow::Result<Vec<VideoRecord>> {
        let sql = if include_deleted {
            "SELECT id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, deleted_at FROM videos ORDER BY create_time DESC"
        } else {
            "SELECT id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, deleted_at FROM videos WHERE deleted_at IS NULL ORDER BY create_time DESC"
        };
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], video_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn video_by_id(&self, id: &str) -> anyhow::Result<VideoRecord> {
        self.conn.query_row(
            "SELECT id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, deleted_at FROM videos WHERE id = ?1",
            params![id],
            video_from_row,
        ).map_err(Into::into)
    }

    pub fn list_playable_videos_for_user(
        &self,
        sec_user_id: &str,
    ) -> anyhow::Result<Vec<VideoRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, deleted_at
             FROM videos WHERE sec_user_id = ?1 AND deleted_at IS NULL AND status = 'completed' ORDER BY create_time DESC",
        )?;
        let rows = stmt.query_map(params![sec_user_id], video_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn mark_video_deleted(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE videos SET status = 'deleted', deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )?;
        Ok(())
    }

    pub fn restore_video(&self, id: &str) -> anyhow::Result<()> {
        self.conn.execute("UPDATE videos SET status = 'completed', deleted_at = NULL, updated_at = ?1 WHERE id = ?2", params![now(), id])?;
        Ok(())
    }

    pub fn deleted_videos_older_than(&self, days: i64) -> anyhow::Result<Vec<VideoRecord>> {
        let cutoff = (Utc::now() - Duration::days(days)).to_rfc3339();
        let mut stmt = self.conn.prepare(
            "SELECT id, sec_user_id, author_name, create_time, aweme_id, desc, kind, status, video_path, manifest_path, cover_path, media_json, bgm_json, deleted_at
             FROM videos WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        )?;
        let rows = stmt.query_map(params![cutoff], video_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn purge_video(&self, id: &str) -> anyhow::Result<()> {
        self.conn
            .execute("DELETE FROM videos WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn cookie_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CookieRecord> {
    Ok(CookieRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        note: row.get(2)?,
        updated_at: row.get(3)?,
        source: row.get(4)?,
        external_key: row.get(5)?,
        last_synced_at: row.get(6)?,
    })
}

fn monitor_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MonitorRecord> {
    Ok(MonitorRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        sec_user_id: row.get(2)?,
        author_name: row.get(3)?,
        cookie_id: row.get(4)?,
        cookie_name: row.get(5)?,
        interval_minutes: row.get(6)?,
        status: row.get(7)?,
        last_run_at: row.get(8)?,
        last_result: row.get(9)?,
        current_phase: row.get(10)?,
        current_downloaded: row.get(11)?,
        current_total: row.get(12)?,
        current_item: row.get(13)?,
        running_started_at: row.get(14)?,
        video_count: row.get::<_, i64>(15)? as usize,
    })
}

fn video_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VideoRecord> {
    Ok(VideoRecord {
        id: row.get(0)?,
        sec_user_id: row.get(1)?,
        author_name: row.get(2)?,
        create_time: row.get(3)?,
        aweme_id: row.get(4)?,
        desc: row.get(5)?,
        kind: row.get(6)?,
        status: row.get(7)?,
        video_path: row.get(8)?,
        manifest_path: row.get(9)?,
        cover_path: row.get(10)?,
        media: serde_json::from_str(&row.get::<_, String>(11)?).unwrap_or_default(),
        bgm: row
            .get::<_, Option<String>>(12)?
            .and_then(|json| serde_json::from_str(&json).ok()),
        deleted_at: row.get(13)?,
    })
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AudioAsset;

    #[test]
    fn creates_cookie_monitor_and_video_tree() {
        let dir = std::env::temp_dir().join(format!("douyin-storage-{}", Uuid::new_v4()));
        let storage = Storage::open(dir.clone()).unwrap();
        let cookie = storage
            .create_cookie("main", Some("note"), "encrypted-cookie")
            .unwrap();
        let monitor = storage
            .create_monitor("https://www.douyin.com/user/sec", "sec", &cookie.id, 15)
            .unwrap();
        assert_eq!(monitor.status, "running");

        let video_path = dir.join("v.mp4");
        fs::write(&video_path, b"video").unwrap();
        let bgm_path = dir.join("bgm.mp3");
        fs::write(&bgm_path, b"audio").unwrap();
        storage
            .upsert_video(&VideoRecord {
                id: "v1".to_string(),
                sec_user_id: "sec".to_string(),
                author_name: "作者".to_string(),
                create_time: 1778215140,
                aweme_id: "a1".to_string(),
                desc: "视频描述".to_string(),
                kind: "video".to_string(),
                status: "completed".to_string(),
                video_path: video_path.to_string_lossy().to_string(),
                manifest_path: "v.json".to_string(),
                cover_path: None,
                media: vec![MediaAsset {
                    kind: "video".to_string(),
                    path: video_path.to_string_lossy().to_string(),
                    width: 0,
                    height: 0,
                    duration_ms: 0,
                }],
                bgm: Some(AudioAsset {
                    path: bgm_path.to_string_lossy().to_string(),
                    title: "背景音乐".to_string(),
                    author: "作者".to_string(),
                    duration_ms: 10_000,
                    start_ms: 0,
                    end_ms: 10_000,
                }),
                deleted_at: None,
            })
            .unwrap();

        let tree = storage.list_video_tree().unwrap();
        assert_eq!(tree[0].author_name, "作者");
        assert_eq!(tree[0].dates[0].videos[0].desc, "视频描述");
        let stored = storage.video_by_id("v1").unwrap();
        assert_eq!(stored.bgm.unwrap().title, "背景音乐");
        assert!(storage
            .post_exists_active(
                "sec",
                1778215140,
                "a1",
                "video",
                &["video".to_string()],
                true,
            )
            .unwrap());
        fs::remove_file(&bgm_path).unwrap();
        assert!(!storage
            .post_exists_active(
                "sec",
                1778215140,
                "a1",
                "video",
                &["video".to_string()],
                true,
            )
            .unwrap());
        fs::write(&bgm_path, b"audio").unwrap();
        fs::remove_file(&video_path).unwrap();
        assert!(!storage
            .post_exists_active(
                "sec",
                1778215140,
                "a1",
                "video",
                &["video".to_string()],
                true,
            )
            .unwrap());
        storage.mark_video_deleted("v1").unwrap();
        assert!(storage.list_video_tree().unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reuses_browser_cookie_for_the_installation_fallback_key() {
        let dir = std::env::temp_dir().join(format!("douyin-browser-cookie-{}", Uuid::new_v4()));
        let storage = Storage::open(dir.clone()).unwrap();
        let fallback = storage
            .upsert_browser_cookie("install:abc", "v1:encrypted", "2026-06-25T10:00:00Z")
            .unwrap();
        let monitor = storage
            .create_monitor(
                "https://www.douyin.com/user/target",
                "target",
                &fallback.id,
                30,
            )
            .unwrap();

        let refreshed = storage
            .upsert_browser_cookie("install:abc", "v1:encrypted-2", "2026-06-25T11:00:00Z")
            .unwrap();
        assert_eq!(fallback.id, refreshed.id);
        assert_eq!(refreshed.external_key.as_deref(), Some("install:abc"));
        assert_eq!(
            storage.monitor_by_id(&monitor.id).unwrap().cookie_id,
            refreshed.id
        );
        assert_eq!(
            storage.browser_cookie_id("install:abc").unwrap().as_deref(),
            Some(refreshed.id.as_str())
        );
        assert_eq!(
            storage
                .active_monitor_by_sec_user_id("target")
                .unwrap()
                .unwrap()
                .id,
            monitor.id
        );
        storage.set_monitor_status(&monitor.id, "error").unwrap();
        storage
            .update_monitor_result(
                &monitor.id,
                "",
                "error",
                "Cookie 可能失效，等待 Chrome 插件同步后重试：401 Unauthorized",
            )
            .unwrap();
        assert!(storage
            .request_cookie_refresh(&refreshed.id, "Cookie 可能失效")
            .unwrap());
        assert!(storage.cookie_refresh_needed("install:abc").unwrap());
        assert_eq!(
            storage.refresh_retry_monitor_ids(&refreshed.id).unwrap(),
            vec![monitor.id.clone()]
        );
        assert!(storage
            .consume_cookie_refresh_request(&refreshed.id)
            .unwrap());
        assert!(!storage.cookie_refresh_needed("install:abc").unwrap());
        assert!(!storage
            .request_cookie_refresh(&refreshed.id, "Cookie 可能失效")
            .unwrap());

        storage
            .set_setting("default_interval_minutes", "45")
            .unwrap();
        assert_eq!(storage.default_interval_minutes().unwrap(), 45);
        let _ = fs::remove_dir_all(dir);
    }
}
