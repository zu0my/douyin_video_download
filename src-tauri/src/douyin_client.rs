use chrono::Utc;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, REFERER, USER_AGENT,
};
use serde::Deserialize;

use crate::types::{CollectedAudio, CollectedMedia, CollectedPost, Manifest, VideoCandidate};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
struct AwemePostResponse {
    aweme_list: Option<Vec<serde_json::Value>>,
    has_more: Option<serde_json::Value>,
    max_cursor: Option<i64>,
    status_code: Option<i64>,
    status_msg: Option<String>,
}

pub fn extract_sec_user_id(input: &str) -> anyhow::Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        anyhow::bail!("empty Douyin user URL");
    }
    if let Ok(url) = reqwest::Url::parse(trimmed) {
        let parts: Vec<_> = url
            .path_segments()
            .map(|segments| segments.collect())
            .unwrap_or_default();
        if parts.len() >= 2 && parts[0] == "user" {
            return Ok(parts[1].to_string());
        }
    }
    Ok(trimmed.to_string())
}

pub fn is_probably_cookie_error(error: &anyhow::Error) -> bool {
    let message = error.to_string().to_lowercase();
    [
        "cookie or signature may be invalid",
        "cookie",
        "signature may be invalid",
        "401 unauthorized",
        "403 forbidden",
        "not login",
        "login required",
        "未登录",
        "登录失效",
        "请登录",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

pub async fn collect_user_posts(
    sec_user_id: &str,
    cookie: &str,
    max_pages: Option<usize>,
) -> anyhow::Result<Manifest> {
    let client = reqwest::Client::builder().user_agent(UA).build()?;
    let mut posts = Vec::new();
    let mut cursor = 0_i64;
    let mut page = 0_usize;
    let mut has_more = true;

    while has_more {
        if max_pages.is_some_and(|limit| page >= limit) {
            break;
        }
        let response = fetch_aweme_page(&client, sec_user_id, cookie, cursor).await?;
        if let Some(code) = response.status_code {
            if code != 0 {
                anyhow::bail!(
                    "Douyin API error: {} ({code})",
                    response.status_msg.unwrap_or_default()
                );
            }
        }
        for item in response.aweme_list.unwrap_or_default() {
            posts.push(normalize_post(item));
        }
        has_more = match response.has_more {
            Some(serde_json::Value::Bool(value)) => value,
            Some(serde_json::Value::Number(value)) => value.as_i64().unwrap_or(0) == 1,
            _ => false,
        };
        cursor = response.max_cursor.unwrap_or_default();
        page += 1;
        if has_more && cursor == 0 {
            anyhow::bail!("Douyin pagination returned has_more without max_cursor");
        }
    }

    let author_name = posts
        .iter()
        .find(|post| !post.author_name.is_empty())
        .map(|post| post.author_name.clone())
        .unwrap_or_else(|| "unknown-author".to_string());
    let video_posts = posts.iter().filter(|post| !post.media.is_empty()).count();
    Ok(Manifest {
        collected_at: Utc::now().to_rfc3339(),
        sec_user_id: sec_user_id.to_string(),
        author_name,
        total_posts: posts.len(),
        video_posts,
        posts,
    })
}

async fn fetch_aweme_page(
    client: &reqwest::Client,
    sec_user_id: &str,
    cookie: &str,
    cursor: i64,
) -> anyhow::Result<AwemePostResponse> {
    let mut url = reqwest::Url::parse("https://www.douyin.com/aweme/v1/web/aweme/post/")?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("device_platform", "webapp");
        query.append_pair("aid", "6383");
        query.append_pair("channel", "channel_pc_web");
        query.append_pair("sec_user_id", sec_user_id);
        query.append_pair("max_cursor", &cursor.to_string());
        query.append_pair("count", "18");
        query.append_pair("publish_video_strategy_type", "2");
        query.append_pair("pc_client_type", "1");
        query.append_pair("version_code", "170400");
        query.append_pair("version_name", "17.4.0");
        if let Some(ms_token) = cookie_value(cookie, "msToken") {
            query.append_pair("msToken", &ms_token);
        }
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/plain, */*"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(UA));
    headers.insert(COOKIE, HeaderValue::from_str(cookie)?);
    headers.insert(
        REFERER,
        HeaderValue::from_str(&format!("https://www.douyin.com/user/{sec_user_id}"))?,
    );

    let text = client
        .get(url)
        .headers(headers)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    if text.trim().is_empty() {
        anyhow::bail!("Douyin API returned empty response; cookie or signature may be invalid");
    }
    Ok(serde_json::from_str(&text)?)
}

fn normalize_post(raw: serde_json::Value) -> CollectedPost {
    let aweme_id = raw
        .pointer("/aweme_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown-aweme")
        .to_string();
    let desc = raw
        .pointer("/desc")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let author_name = raw
        .pointer("/author/nickname")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown-author")
        .to_string();
    let create_time = raw
        .pointer("/create_time")
        .and_then(serde_json::Value::as_i64);
    let top_level_video_candidates = select_video_candidates(raw.get("video"));
    let mut media = select_ordered_media(&raw);
    if media.is_empty() && !top_level_video_candidates.is_empty() {
        let video = raw.get("video");
        media.push(CollectedMedia {
            kind: "video".to_string(),
            image_urls: Vec::new(),
            video_candidates: top_level_video_candidates.clone(),
            width: video
                .and_then(|value| value.get("width"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
            height: video
                .and_then(|value| value.get("height"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
            duration_ms: video
                .and_then(|value| value.get("duration"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
        });
    }
    let has_images = media.iter().any(|item| item.kind == "image");
    let has_videos = media.iter().any(|item| item.kind == "video");
    let kind = match (has_images, has_videos) {
        (true, true) => "mixed",
        (true, false) => "image",
        (false, true) => "video",
        (false, false) => "unknown",
    }
    .to_string();
    let bgm = if kind == "image" || kind == "mixed" {
        select_bgm(&raw)
    } else {
        None
    };

    CollectedPost {
        aweme_id,
        desc,
        author_name,
        create_time,
        kind,
        raw,
        media,
        bgm,
        video_candidates: top_level_video_candidates,
    }
}

fn select_ordered_media(raw: &serde_json::Value) -> Vec<CollectedMedia> {
    let Some(images) = raw.get("images").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let is_image_post = raw.get("aweme_type").and_then(serde_json::Value::as_i64) == Some(68)
        || images.iter().any(|item| item.get("clip_type").is_some());
    if !is_image_post {
        return Vec::new();
    }

    images
        .iter()
        .filter_map(|item| {
            let image_urls = select_image_urls(item);
            let nested_video = item.get("video");
            let video_candidates = select_video_candidates(nested_video);
            // Moving-photo variants use multiple clip_type values (observed:
            // 1, 3, 4 and 5). A nested playable video is the stable signal.
            let is_video_clip = !video_candidates.is_empty();
            if is_video_clip {
                let video = nested_video.unwrap_or(item);
                Some(CollectedMedia {
                    kind: "video".to_string(),
                    image_urls,
                    video_candidates,
                    width: video
                        .get("width")
                        .and_then(serde_json::Value::as_i64)
                        .or_else(|| item.get("width").and_then(serde_json::Value::as_i64))
                        .unwrap_or(0),
                    height: video
                        .get("height")
                        .and_then(serde_json::Value::as_i64)
                        .or_else(|| item.get("height").and_then(serde_json::Value::as_i64))
                        .unwrap_or(0),
                    duration_ms: video
                        .get("duration")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(0),
                })
            } else if !image_urls.is_empty() {
                Some(CollectedMedia {
                    kind: "image".to_string(),
                    image_urls,
                    video_candidates: Vec::new(),
                    width: item
                        .get("width")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(0),
                    height: item
                        .get("height")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(0),
                    duration_ms: 0,
                })
            } else {
                None
            }
        })
        .collect()
}

fn select_bgm(raw: &serde_json::Value) -> Option<CollectedAudio> {
    let music = raw.get("music")?;
    let urls = music
        .pointer("/play_url/url_list")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return None;
    }
    let duration_ms = music
        .get("duration")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0)
        .saturating_mul(1000);
    let start_ms = raw
        .pointer("/image_album_music_info/begin_time")
        .and_then(serde_json::Value::as_i64)
        .or_else(|| music.get("start_time").and_then(serde_json::Value::as_i64))
        .unwrap_or(0)
        .max(0);
    let configured_end_ms = raw
        .pointer("/image_album_music_info/end_time")
        .and_then(serde_json::Value::as_i64)
        .or_else(|| music.get("end_time").and_then(serde_json::Value::as_i64))
        .unwrap_or(0);
    let end_ms = if configured_end_ms > start_ms {
        configured_end_ms
    } else {
        start_ms.saturating_add(duration_ms)
    };
    Some(CollectedAudio {
        urls,
        title: music
            .get("title")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
        author: music
            .get("author")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
        duration_ms,
        start_ms,
        end_ms,
    })
}

fn select_image_urls(image: &serde_json::Value) -> Vec<String> {
    let mut urls = Vec::new();
    for key in [
        "watermark_free_download_url_list",
        "url_list",
        "download_url_list",
    ] {
        if let Some(items) = image.get(key).and_then(serde_json::Value::as_array) {
            for url in items.iter().filter_map(serde_json::Value::as_str) {
                if !urls.iter().any(|item| item == url) {
                    urls.push(url.to_string());
                }
            }
        }
    }
    urls
}

pub fn select_video_candidates(video: Option<&serde_json::Value>) -> Vec<VideoCandidate> {
    let mut candidates = Vec::new();
    let Some(video) = video else {
        return candidates;
    };
    if let Some(bit_rates) = video.get("bit_rate").and_then(serde_json::Value::as_array) {
        for item in bit_rates {
            if let Some(urls) = item
                .pointer("/play_addr/url_list")
                .and_then(serde_json::Value::as_array)
            {
                for url in urls.iter().filter_map(serde_json::Value::as_str) {
                    candidates.push(VideoCandidate {
                        url: url.to_string(),
                        bit_rate: item
                            .get("bit_rate")
                            .and_then(serde_json::Value::as_i64)
                            .unwrap_or(0),
                        data_size: item
                            .pointer("/play_addr/data_size")
                            .and_then(serde_json::Value::as_i64)
                            .unwrap_or(0),
                        width: item
                            .pointer("/play_addr/width")
                            .and_then(serde_json::Value::as_i64)
                            .or_else(|| video.get("width").and_then(serde_json::Value::as_i64))
                            .unwrap_or(0),
                        height: item
                            .pointer("/play_addr/height")
                            .and_then(serde_json::Value::as_i64)
                            .or_else(|| video.get("height").and_then(serde_json::Value::as_i64))
                            .unwrap_or(0),
                        quality: item
                            .get("gear_name")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    });
                }
            }
        }
    }
    if let Some(urls) = video
        .pointer("/play_addr/url_list")
        .and_then(serde_json::Value::as_array)
    {
        for url in urls.iter().filter_map(serde_json::Value::as_str) {
            candidates.push(VideoCandidate {
                url: url.to_string(),
                bit_rate: 0,
                data_size: video
                    .pointer("/play_addr/data_size")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(0),
                width: video
                    .pointer("/play_addr/width")
                    .and_then(serde_json::Value::as_i64)
                    .or_else(|| video.get("width").and_then(serde_json::Value::as_i64))
                    .unwrap_or(0),
                height: video
                    .pointer("/play_addr/height")
                    .and_then(serde_json::Value::as_i64)
                    .or_else(|| video.get("height").and_then(serde_json::Value::as_i64))
                    .unwrap_or(0),
                quality: Some("play_addr".to_string()),
            });
        }
    }
    candidates.sort_by(|a, b| {
        b.bit_rate
            .cmp(&a.bit_rate)
            .then_with(|| b.data_size.cmp(&a.data_size))
            .then_with(|| (b.width * b.height).cmp(&(a.width * a.height)))
    });
    candidates.dedup_by(|a, b| a.url == b.url);
    candidates
}

fn cookie_value(cookie: &str, key: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let mut pieces = part.trim().splitn(2, '=');
        match (pieces.next(), pieces.next()) {
            (Some(name), Some(value)) if name == key => Some(value.to_string()),
            _ => None,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_sec_user_id_from_url_or_raw_value() {
        assert_eq!(
            extract_sec_user_id("https://www.douyin.com/user/MS4wABC?x=1").unwrap(),
            "MS4wABC"
        );
        assert_eq!(extract_sec_user_id("MS4wABC").unwrap(), "MS4wABC");
    }

    #[test]
    fn sorts_highest_quality_candidates_first() {
        let video = json!({
            "bit_rate": [
                { "bit_rate": 100, "play_addr": { "url_list": ["low"], "data_size": 10, "width": 320, "height": 180 } },
                { "bit_rate": 1000, "play_addr": { "url_list": ["high"], "data_size": 20, "width": 1920, "height": 1080 } }
            ]
        });
        let candidates = select_video_candidates(Some(&video));
        assert_eq!(candidates[0].url, "high");
    }

    #[test]
    fn recognizes_ordered_image_and_video_clips() {
        let raw = json!({
            "aweme_id": "mixed",
            "aweme_type": 68,
            "images": [
                { "clip_type": 2, "url_list": ["image"], "width": 100, "height": 200 },
                {
                    "clip_type": 3,
                    "url_list": ["poster"],
                    "video": {
                        "width": 720,
                        "height": 1280,
                        "play_addr": { "url_list": ["video"] }
                    }
                }
            ]
        });
        let post = normalize_post(raw);
        assert_eq!(post.kind, "mixed");
        assert_eq!(post.media.len(), 2);
        assert_eq!(post.media[0].kind, "image");
        assert_eq!(post.media[1].kind, "video");
    }

    #[test]
    fn recognizes_live_photo_clip_types_as_video() {
        for clip_type in [1, 4, 5] {
            let raw = json!({
                "aweme_id": format!("live-{clip_type}"),
                "aweme_type": 68,
                "images": [{
                    "clip_type": clip_type,
                    "live_photo_type": 1,
                    "url_list": ["poster"],
                    "video": {
                        "width": 720,
                        "height": 1280,
                        "play_addr": { "url_list": ["video"] }
                    }
                }]
            });
            let post = normalize_post(raw);
            assert_eq!(post.kind, "video");
            assert_eq!(post.media[0].kind, "video");
        }
    }

    #[test]
    fn extracts_image_post_bgm_timing() {
        let raw = json!({
            "aweme_id": "image-with-bgm",
            "aweme_type": 68,
            "images": [{ "clip_type": 2, "url_list": ["image"] }],
            "music": {
                "title": "背景音乐",
                "author": "作者",
                "duration": 12,
                "play_url": { "url_list": ["music.mp3"] }
            },
            "image_album_music_info": {
                "begin_time": 1000,
                "end_time": 11000
            }
        });
        let post = normalize_post(raw);
        let bgm = post.bgm.unwrap();
        assert_eq!(bgm.urls, vec!["music.mp3"]);
        assert_eq!(bgm.duration_ms, 12_000);
        assert_eq!(bgm.start_ms, 1_000);
        assert_eq!(bgm.end_ms, 11_000);
    }

    #[test]
    fn ignores_bgm_for_pure_video_posts() {
        let raw = json!({
            "aweme_id": "video-with-music",
            "video": { "play_addr": { "url_list": ["video.mp4"] } },
            "music": {
                "duration": 12,
                "play_url": { "url_list": ["music.mp3"] }
            }
        });
        assert!(normalize_post(raw).bgm.is_none());
    }

    #[test]
    fn identifies_cookie_related_failures() {
        assert!(is_probably_cookie_error(&anyhow::anyhow!(
            "Douyin API returned empty response; cookie or signature may be invalid"
        )));
        assert!(is_probably_cookie_error(&anyhow::anyhow!(
            "HTTP status client error (403 Forbidden)"
        )));
        assert!(!is_probably_cookie_error(&anyhow::anyhow!(
            "network connection reset"
        )));
    }
}
