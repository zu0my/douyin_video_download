use std::cmp::Reverse;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, COOKIE, RANGE, REFERER, USER_AGENT};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::douyin_client::select_video_candidates;
use crate::types::{AudioAsset, CollectedPost, MediaAsset, VideoRecord};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

pub async fn download_posts_to_dir(
    base_downloads_dir: &Path,
    cookie: &str,
    sec_user_id: &str,
    posts: &[CollectedPost],
) -> anyhow::Result<Vec<VideoRecord>> {
    let client = reqwest::Client::builder().user_agent(UA).build()?;
    let user_dir = base_downloads_dir.join(sec_user_id);
    let videos_dir = user_dir.join("videos");
    fs::create_dir_all(&videos_dir).await?;
    let mut downloaded = Vec::new();

    for post in posts.iter().filter(|post| !post.media.is_empty()) {
        let Some(create_time) = post.create_time else {
            continue;
        };
        let stem = create_time.to_string();
        let manifest_path = user_dir.join(format!("{stem}.json"));
        fs::write(&manifest_path, serde_json::to_vec_pretty(post)?).await?;

        let (video_path, cover_path, media, bgm) = if post.kind == "video" && post.media.len() == 1
        {
            let video_path = videos_dir.join(format!("{stem}.mp4"));
            let cover_path = user_dir.join(format!("{stem}.jpg"));
            download_video_candidates(
                &client,
                cookie,
                &post.media[0].video_candidates,
                &video_path,
            )
            .await?;
            let cover = download_cover(&client, post, &cover_path).await.ok();
            (
                video_path.to_string_lossy().to_string(),
                cover.map(|path| path.to_string_lossy().to_string()),
                vec![MediaAsset {
                    kind: "video".to_string(),
                    path: video_path.to_string_lossy().to_string(),
                    width: post.media[0].width,
                    height: post.media[0].height,
                    duration_ms: post.media[0].duration_ms,
                }],
                None,
            )
        } else {
            let media_dir = user_dir.join("media").join(&stem);
            fs::create_dir_all(&media_dir).await?;
            let mut assets = Vec::new();
            let mut cover = None;
            for (index, item) in post.media.iter().enumerate() {
                let order = index + 1;
                if item.kind == "video" {
                    let path = media_dir.join(format!("{order:03}.mp4"));
                    download_video_candidates(&client, cookie, &item.video_candidates, &path)
                        .await?;
                    if cover.is_none() && !item.image_urls.is_empty() {
                        let poster = media_dir.join(format!("{order:03}-poster.webp"));
                        if download_image_candidates(&client, &item.image_urls, &poster)
                            .await
                            .is_ok()
                        {
                            cover = Some(poster.to_string_lossy().to_string());
                        }
                    }
                    assets.push(MediaAsset {
                        kind: "video".to_string(),
                        path: path.to_string_lossy().to_string(),
                        width: item.width,
                        height: item.height,
                        duration_ms: item.duration_ms,
                    });
                } else {
                    let path = media_dir.join(format!("{order:03}.webp"));
                    download_image_candidates(&client, &item.image_urls, &path).await?;
                    if cover.is_none() {
                        cover = Some(path.to_string_lossy().to_string());
                    }
                    assets.push(MediaAsset {
                        kind: "image".to_string(),
                        path: path.to_string_lossy().to_string(),
                        width: item.width,
                        height: item.height,
                        duration_ms: 0,
                    });
                }
            }
            let bgm = if let Some(source) = &post.bgm {
                let path = media_dir.join("bgm.mp3");
                download_audio_candidates(&client, cookie, &source.urls, &path).await?;
                Some(AudioAsset {
                    path: path.to_string_lossy().to_string(),
                    title: source.title.clone(),
                    author: source.author.clone(),
                    duration_ms: source.duration_ms,
                    start_ms: source.start_ms,
                    end_ms: source.end_ms,
                })
            } else {
                None
            };
            let primary_video = assets
                .iter()
                .find(|asset| asset.kind == "video")
                .map(|asset| asset.path.clone())
                .unwrap_or_default();
            (primary_video, cover, assets, bgm)
        };

        downloaded.push(VideoRecord {
            id: Uuid::new_v4().to_string(),
            sec_user_id: sec_user_id.to_string(),
            author_name: post.author_name.clone(),
            create_time,
            aweme_id: post.aweme_id.clone(),
            desc: post.desc.clone(),
            kind: post.kind.clone(),
            status: "completed".to_string(),
            video_path,
            manifest_path: manifest_path.to_string_lossy().to_string(),
            cover_path,
            media,
            bgm,
            deleted_at: None,
        });
    }
    Ok(downloaded)
}

async fn download_audio_candidates(
    client: &reqwest::Client,
    cookie: &str,
    urls: &[String],
    final_path: &Path,
) -> anyhow::Result<()> {
    if fs::try_exists(final_path).await? {
        return Ok(());
    }
    let part_path = final_path.with_extension("mp3.part");
    for url in urls {
        if stream_url(client, cookie, url, &part_path, final_path)
            .await
            .is_ok()
        {
            return Ok(());
        }
    }
    anyhow::bail!("all BGM candidates failed")
}

async fn download_image_candidates(
    client: &reqwest::Client,
    urls: &[String],
    final_path: &Path,
) -> anyhow::Result<()> {
    if fs::try_exists(final_path).await? {
        return Ok(());
    }
    for url in urls {
        let result = async {
            let response = client
                .get(url)
                .header(USER_AGENT, UA)
                .header(REFERER, "https://www.douyin.com/")
                .send()
                .await?;
            let bytes = response.error_for_status()?.bytes().await?;
            fs::write(final_path, bytes).await?;
            anyhow::Ok(())
        }
        .await;
        if result.is_ok() {
            return Ok(());
        }
    }
    anyhow::bail!("all image candidates failed")
}

async fn download_video_candidates(
    client: &reqwest::Client,
    cookie: &str,
    candidates: &[crate::types::VideoCandidate],
    final_path: &Path,
) -> anyhow::Result<()> {
    if fs::try_exists(final_path).await? {
        return Ok(());
    }
    let part_path = final_path.with_extension("mp4.part");
    for candidate in candidates {
        if stream_url(client, cookie, &candidate.url, &part_path, final_path)
            .await
            .is_ok()
        {
            return Ok(());
        }
    }
    anyhow::bail!("all video stream candidates failed")
}

async fn stream_url(
    client: &reqwest::Client,
    cookie: &str,
    url: &str,
    part_path: &Path,
    final_path: &Path,
) -> anyhow::Result<()> {
    let existing = fs::metadata(part_path)
        .await
        .map(|meta| meta.len())
        .unwrap_or(0);
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(USER_AGENT, HeaderValue::from_static(UA));
    headers.insert(REFERER, HeaderValue::from_static("https://www.douyin.com/"));
    headers.insert(COOKIE, HeaderValue::from_str(cookie)?);
    if existing > 0 {
        headers.insert(RANGE, HeaderValue::from_str(&format!("bytes={existing}-"))?);
    }

    let response = client.get(url).headers(headers).send().await?;
    let append = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if existing > 0 && !append {
        let _ = fs::remove_file(part_path).await;
    }

    let mut file = if append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(part_path)
            .await?
    } else {
        File::create(part_path).await?
    };
    let mut stream = response.error_for_status()?.bytes_stream();
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    fs::rename(part_path, final_path).await?;
    Ok(())
}

pub async fn download_cover(
    client: &reqwest::Client,
    post: &CollectedPost,
    cover_path: &Path,
) -> anyhow::Result<PathBuf> {
    if fs::try_exists(cover_path).await? {
        return Ok(cover_path.to_path_buf());
    }
    for url in extract_cover_urls(post) {
        let result = async {
            let response = client
                .get(&url)
                .header(USER_AGENT, UA)
                .header(REFERER, "https://www.douyin.com/")
                .send()
                .await?;
            let bytes = response.error_for_status()?.bytes().await?;
            fs::write(cover_path, bytes).await?;
            anyhow::Ok(())
        }
        .await;
        if result.is_ok() {
            return Ok(cover_path.to_path_buf());
        }
    }
    anyhow::bail!("no cover URL succeeded")
}

fn extract_cover_urls(post: &CollectedPost) -> Vec<String> {
    let cover = post
        .raw
        .pointer("/video/cover/url_list")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut urls: Vec<String> = cover
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    urls.sort_by_key(|url| Reverse(cover_score(url)));
    for pointer in [
        "/video/raw_cover/url_list",
        "/video/origin_cover/url_list",
        "/video/dynamic_cover/url_list",
    ] {
        if let Some(list) = post
            .raw
            .pointer(pointer)
            .and_then(serde_json::Value::as_array)
        {
            for url in list.iter().filter_map(serde_json::Value::as_str) {
                if !urls.iter().any(|item| item == url) {
                    urls.push(url.to_string());
                }
            }
        }
    }
    urls
}

fn cover_score(url: &str) -> i32 {
    let lower = url.to_lowercase();
    let mut score = 0;
    if lower.contains("/obj/") {
        score += 80;
    }
    if !lower.contains("cropcenter") {
        score += 60;
    }
    if lower.contains("se=false") {
        score += 25;
    }
    if lower.contains("se=true") {
        score -= 25;
    }
    if lower.contains("sh=323_430") {
        score -= 40;
    }
    let hash = Sha256::digest(url.as_bytes());
    score + (hash[0] as i32 % 3)
}

#[allow(dead_code)]
pub fn manifest_summary(post: &CollectedPost) -> serde_json::Value {
    json!({
        "awemeId": post.aweme_id,
        "createTime": post.create_time,
        "desc": post.desc,
        "authorName": post.author_name,
        "candidates": select_video_candidates(post.raw.get("video")).len()
    })
}
