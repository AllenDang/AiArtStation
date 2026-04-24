use crate::commands::generation::AppState;
use crate::providers::{ReferenceMedia, RequestOptions};
use crate::storage::{VideoRecord, VideoStatusUpdate};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{Emitter, State};
use uuid::Uuid;

/// Global flag to track if the download progress callback has been registered
static PROGRESS_CB_REGISTERED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Video {
    pub id: String,
    pub project_id: Option<String>,
    pub task_id: String,
    pub file_path: Option<String>,
    pub first_frame_thumbnail: Option<String>,
    pub last_frame_thumbnail: Option<String>,
    pub first_frame_path: Option<String>,
    pub last_frame_path: Option<String>,
    pub vocals_path: Option<String>,
    pub bgm_path: Option<String>,
    pub prompt: String,
    pub model: String,
    pub generation_type: String,
    pub source_image_id: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<f64>,
    pub fps: Option<i32>,
    pub aspect_ratio: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub tokens_used: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub asset_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateVideoRequest {
    pub project_id: String,
    pub provider_type: String,
    pub prompt: String,
    pub first_frame: Option<String>,           // Base64
    pub last_frame: Option<String>,            // Base64
    pub reference_images: Option<Vec<String>>, // Base64 array for multi-ref
    pub reference_videos: Option<Vec<String>>, // Base64 data URLs for reference videos
    pub reference_audios: Option<Vec<String>>, // Base64 data URLs for reference audios
    /// Provider-specific parameters rendered from the manifest.
    /// Must contain `generation_type` if the manifest exposes one.
    pub params: Value,
    pub source_image_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateVideoResponse {
    pub id: String,
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoGalleryResponse {
    pub videos: Vec<Video>,
    pub total: i64,
    pub has_more: bool,
}

#[tauri::command]
pub async fn generate_video(
    state: State<'_, AppState>,
    request: GenerateVideoRequest,
) -> Result<GenerateVideoResponse, String> {
    // Look up provider + snapshot credentials before network call.
    let provider_record = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_provider(&request.provider_type)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Provider 未配置".to_string())?
    };

    let model = provider_record
        .video_model
        .clone()
        .ok_or_else(|| "该 Provider 未配置视频模型".to_string())?;

    let provider = state
        .registry
        .get(&provider_record.provider_type)
        .ok_or_else(|| format!("未知的 Provider 类型: {}", provider_record.provider_type))?;

    let reference = ReferenceMedia {
        reference_images: request.reference_images.clone().unwrap_or_default(),
        first_frame: request.first_frame.clone(),
        last_frame: request.last_frame.clone(),
        reference_videos: request.reference_videos.clone().unwrap_or_default(),
        reference_audios: request.reference_audios.clone().unwrap_or_default(),
    };

    let options = RequestOptions {
        no_proxy: provider_record.no_proxy,
    };
    let task = provider
        .create_video_task(
            &provider_record.credentials,
            &model,
            &request.prompt,
            &request.params,
            &reference,
            options,
        )
        .await
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();

    let record = VideoRecord {
        id: id.clone(),
        project_id: Some(request.project_id),
        task_id: task.task_id.clone(),
        file_path: None,
        first_frame_thumbnail: None,
        last_frame_thumbnail: None,
        first_frame_path: None,
        last_frame_path: None,
        vocals_path: None,
        bgm_path: None,
        prompt: request.prompt,
        provider_type: provider_record.provider_type.clone(),
        credentials_snapshot: provider_record.credentials.clone(),
        no_proxy: provider_record.no_proxy,
        model,
        generation_type: task.metadata.generation_type.clone(),
        source_image_id: request.source_image_id,
        resolution: task.metadata.resolution.clone(),
        duration: task.metadata.duration,
        fps: Some(24),
        aspect_ratio: task.metadata.aspect_ratio.clone(),
        status: "pending".to_string(),
        error_message: None,
        tokens_used: None,
        created_at: Utc::now(),
        completed_at: None,
        asset_types: Vec::new(),
    };

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.insert_video(&record).map_err(|e| e.to_string())?;
    }

    Ok(GenerateVideoResponse {
        id,
        task_id: task.task_id,
        status: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn poll_video_task(state: State<'_, AppState>, id: String) -> Result<Video, String> {
    // Load record + output dir. Credentials come from the record snapshot so
    // edits/deletes to the provider don't break in-flight tasks.
    let (record, output_directory) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let record = db
            .get_video_by_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Video not found".to_string())?;
        let settings = db.load_app_settings().map_err(|e| e.to_string())?;
        (record, settings.output_directory)
    };

    if record.status == "completed" || record.status == "failed" {
        return Ok(map_to_video(record));
    }

    let provider = state
        .registry
        .get(&record.provider_type)
        .ok_or_else(|| format!("未知的 Provider 类型: {}", record.provider_type))?;

    let status_response = provider
        .poll_video_task(
            &record.credentials_snapshot,
            &record.task_id,
            RequestOptions {
                no_proxy: record.no_proxy,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let new_status = status_response.status.as_str();

    if new_status != record.status {
        let downloaded = if new_status == "completed" {
            if let Some(video_url) = &status_response.video_url {
                download_video(video_url, &output_directory, &id, true)
                    .await
                    .ok()
            } else {
                None
            }
        } else {
            None
        };

        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let update = VideoStatusUpdate {
                status: new_status,
                file_path: downloaded.as_ref().map(|d| d.file_path.as_str()),
                first_frame_thumbnail: downloaded
                    .as_ref()
                    .and_then(|d| d.first_frame_thumbnail.as_deref()),
                last_frame_thumbnail: downloaded
                    .as_ref()
                    .and_then(|d| d.last_frame_thumbnail.as_deref()),
                first_frame_path: downloaded
                    .as_ref()
                    .and_then(|d| d.first_frame_path.as_deref()),
                last_frame_path: downloaded
                    .as_ref()
                    .and_then(|d| d.last_frame_path.as_deref()),
                vocals_path: downloaded.as_ref().and_then(|d| d.vocals_path.as_deref()),
                bgm_path: downloaded.as_ref().and_then(|d| d.bgm_path.as_deref()),
                resolution: status_response.resolution.as_deref(),
                duration: status_response.duration,
                fps: status_response.fps,
                tokens_used: status_response.tokens_used,
                error_message: status_response.error_message.as_deref(),
            };
            db.update_video_status(&id, &update)
                .map_err(|e| e.to_string())?;
        }
    }

    let updated_record = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_video_by_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Video not found".to_string())?
    };

    Ok(map_to_video(updated_record))
}

#[tauri::command]
pub async fn get_videos(
    state: State<'_, AppState>,
    project_id: String,
    page: i64,
    page_size: i64,
) -> Result<VideoGalleryResponse, String> {
    let offset = page * page_size;

    let (videos, total) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let videos = db
            .get_videos_by_project(&project_id, page_size, offset)
            .map_err(|e| e.to_string())?;
        let total = db
            .get_video_count(Some(&project_id))
            .map_err(|e| e.to_string())?;
        (videos, total)
    };

    let video_list: Vec<Video> = videos.into_iter().map(map_to_video).collect();
    let has_more = (offset + page_size) < total;

    Ok(VideoGalleryResponse {
        videos: video_list,
        total,
        has_more,
    })
}

#[tauri::command]
pub async fn get_videos_by_asset_type(
    state: State<'_, AppState>,
    project_id: String,
    asset_type: String,
    page: i64,
    page_size: i64,
) -> Result<VideoGalleryResponse, String> {
    let offset = page * page_size;

    let (videos, total) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let videos = db
            .get_videos_by_asset_type(&project_id, &asset_type, page_size, offset)
            .map_err(|e| e.to_string())?;
        let total = db
            .get_video_count_by_asset_type(&project_id, &asset_type)
            .map_err(|e| e.to_string())?;
        (videos, total)
    };

    let video_list: Vec<Video> = videos.into_iter().map(map_to_video).collect();
    let has_more = (offset + page_size) < total;

    Ok(VideoGalleryResponse {
        videos: video_list,
        total,
        has_more,
    })
}

#[tauri::command]
pub async fn get_video_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Video>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let record = db.get_video_by_id(&id).map_err(|e| e.to_string())?;
    Ok(record.map(map_to_video))
}

#[tauri::command]
pub async fn get_pending_videos(state: State<'_, AppState>) -> Result<Vec<Video>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.get_pending_videos().map_err(|e| e.to_string())?;
    Ok(records.into_iter().map(map_to_video).collect())
}

#[tauri::command]
pub async fn delete_video(
    state: State<'_, AppState>,
    id: String,
    delete_file: bool,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    if delete_file && let Ok(Some(record)) = db.get_video_by_id(&id) {
        // Delete video file
        if let Some(file_path) = record.file_path {
            let _ = std::fs::remove_file(&file_path);
        }
        // Delete first frame image
        if let Some(first_frame_path) = record.first_frame_path {
            let _ = std::fs::remove_file(&first_frame_path);
        }
        // Delete last frame image
        if let Some(last_frame_path) = record.last_frame_path {
            let _ = std::fs::remove_file(&last_frame_path);
        }
        // Delete separated audio files
        if let Some(vocals_path) = record.vocals_path {
            let _ = std::fs::remove_file(&vocals_path);
        }
        if let Some(bgm_path) = record.bgm_path {
            let _ = std::fs::remove_file(&bgm_path);
        }
    }

    db.delete_video(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_video_tag(
    state: State<'_, AppState>,
    id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_video_asset_type(&id, &asset_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_video_tag(
    state: State<'_, AppState>,
    id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_video_asset_type(&id, &asset_type)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Stem Model Management Commands
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StemModelStatus {
    pub downloaded: bool,
    pub model_size_mb: f64,
    pub cache_path: String,
}

/// Check if the stem separation model is already downloaded
#[tauri::command]
pub async fn check_stem_model_status() -> Result<StemModelStatus, String> {
    // Replicate the path logic from stem-splitter-core to check if model exists
    let cache_dir = stem_splitter_core::io::paths::models_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {:?}", e))?;

    let model_path = find_model_file(&cache_dir);

    match model_path {
        Some(path) => {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok(StemModelStatus {
                downloaded: true,
                model_size_mb: size as f64 / (1024.0 * 1024.0),
                cache_path: cache_dir.to_string_lossy().to_string(),
            })
        }
        None => Ok(StemModelStatus {
            downloaded: false,
            model_size_mb: 0.0,
            cache_path: cache_dir.to_string_lossy().to_string(),
        }),
    }
}

/// Download the stem separation model with progress events emitted to frontend
#[tauri::command]
pub async fn download_stem_model(app: tauri::AppHandle) -> Result<(), String> {
    // Register progress callback once (OnceLock ensures this only runs once per process)
    PROGRESS_CB_REGISTERED.get_or_init(|| {
        let app_handle = app.clone();
        stem_splitter_core::set_download_progress_callback(move |downloaded, total| {
            let _ = app_handle.emit("stem-model-download-progress", (downloaded, total));
        });
    });

    // Run the blocking download in a background thread
    tokio::task::spawn_blocking(move || {
        stem_splitter_core::prepare_model("htdemucs_ort_v1", None)
            .map_err(|e| format!("Model download failed: {:?}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Delete the downloaded stem model to free disk space
#[tauri::command]
pub async fn delete_stem_model() -> Result<(), String> {
    let cache_dir = stem_splitter_core::io::paths::models_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {:?}", e))?;

    if let Some(path) = find_model_file(&cache_dir) {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    Ok(())
}

/// Find the HTDemucs model file in the cache directory
fn find_model_file(cache_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    if !cache_dir.exists() {
        return None;
    }
    // Model files are named like "HTDemucs-ORT-{hash8}.ort"
    std::fs::read_dir(cache_dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".ort") && name.starts_with("HTDemucs") {
            Some(entry.path())
        } else {
            None
        }
    })
}

/// Check if the stem model is ready for use (downloaded and available)
fn is_stem_model_ready() -> bool {
    stem_splitter_core::io::paths::models_cache_dir()
        .ok()
        .and_then(|dir| find_model_file(&dir))
        .is_some()
}

fn map_to_video(record: VideoRecord) -> Video {
    Video {
        id: record.id,
        project_id: record.project_id,
        task_id: record.task_id,
        file_path: record.file_path,
        first_frame_thumbnail: record.first_frame_thumbnail,
        last_frame_thumbnail: record.last_frame_thumbnail,
        first_frame_path: record.first_frame_path,
        last_frame_path: record.last_frame_path,
        vocals_path: record.vocals_path,
        bgm_path: record.bgm_path,
        prompt: record.prompt,
        model: record.model,
        generation_type: record.generation_type,
        source_image_id: record.source_image_id,
        resolution: record.resolution,
        duration: record.duration,
        fps: record.fps,
        aspect_ratio: record.aspect_ratio,
        status: record.status,
        error_message: record.error_message,
        tokens_used: record.tokens_used,
        created_at: record.created_at.to_rfc3339(),
        completed_at: record.completed_at.map(|dt| dt.to_rfc3339()),
        asset_types: record.asset_types,
    }
}

/// Result of downloading a video, including file path and extracted frames
struct DownloadedVideo {
    file_path: String,
    first_frame_thumbnail: Option<String>,
    last_frame_thumbnail: Option<String>,
    first_frame_path: Option<String>,
    last_frame_path: Option<String>,
    vocals_path: Option<String>,
    bgm_path: Option<String>,
}

async fn download_video(
    url: &str,
    output_dir: &str,
    video_id: &str,
    organize_by_date: bool,
) -> Result<DownloadedVideo, String> {
    use chrono::Local;
    use std::path::PathBuf;

    // Create output directory
    let mut path = PathBuf::from(output_dir);
    if organize_by_date {
        let date = Local::now().format("%Y-%m").to_string();
        path.push(&date);
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    // Generate deterministic filename using video_id to prevent duplicate downloads
    let id_hash: String = video_id.chars().take(8).collect();
    let filename = format!("video_{}.mp4", id_hash);
    path.push(&filename);

    // Check if file already exists (prevents race condition with concurrent polls)
    if path.exists() {
        let file_path = path.to_string_lossy().to_string();
        // Extract frames from existing video
        let frames = extract_video_frames(&file_path).ok();
        // Separate audio stems from existing video
        let stems = match separate_audio_stems(&file_path) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("Audio stem separation failed for {}: {}", file_path, e);
                None
            }
        };
        return Ok(DownloadedVideo {
            file_path,
            first_frame_thumbnail: frames
                .as_ref()
                .and_then(|f| f.first_frame_thumbnail.clone()),
            last_frame_thumbnail: frames.as_ref().and_then(|f| f.last_frame_thumbnail.clone()),
            first_frame_path: frames.as_ref().and_then(|f| f.first_frame_path.clone()),
            last_frame_path: frames.as_ref().and_then(|f| f.last_frame_path.clone()),
            vocals_path: stems.as_ref().and_then(|s| s.vocals_path.clone()),
            bgm_path: stems.as_ref().and_then(|s| s.bgm_path.clone()),
        });
    }

    // Download video
    let client = reqwest::Client::new();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Failed to download video: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    let file_path = path.to_string_lossy().to_string();

    // Extract first and last frames from the video
    let frames = extract_video_frames(&file_path).ok();

    // Separate audio stems (vocals + BGM) from the video
    let stems = match separate_audio_stems(&file_path) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("Audio stem separation failed for {}: {}", file_path, e);
            None
        }
    };

    Ok(DownloadedVideo {
        file_path,
        first_frame_thumbnail: frames
            .as_ref()
            .and_then(|f| f.first_frame_thumbnail.clone()),
        last_frame_thumbnail: frames.as_ref().and_then(|f| f.last_frame_thumbnail.clone()),
        first_frame_path: frames.as_ref().and_then(|f| f.first_frame_path.clone()),
        last_frame_path: frames.as_ref().and_then(|f| f.last_frame_path.clone()),
        vocals_path: stems.as_ref().and_then(|s| s.vocals_path.clone()),
        bgm_path: stems.as_ref().and_then(|s| s.bgm_path.clone()),
    })
}

/// Result of extracting frames from a video
struct ExtractedFrames {
    first_frame_thumbnail: Option<String>,
    last_frame_thumbnail: Option<String>,
    first_frame_path: Option<String>,
    last_frame_path: Option<String>,
}

/// Extract first and last frames from the video using ffmpeg-next
fn extract_video_frames(video_path: &str) -> Result<ExtractedFrames, String> {
    use std::path::Path;

    let video_stem = Path::new(video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let video_dir = Path::new(video_path)
        .parent()
        .ok_or("Cannot get video directory")?;

    // Paths for full-resolution frames
    let first_frame_path = video_dir.join(format!("{}_first.jpg", video_stem));
    let last_frame_path = video_dir.join(format!("{}_last.jpg", video_stem));

    // Extract first frame (near the beginning)
    let first_frame_ok = extract_frame_at_position(
        video_path,
        first_frame_path.to_str().unwrap(),
        FramePosition::Start,
    )
    .is_ok();

    // Extract last frame (near the end)
    let last_frame_ok = extract_frame_at_position(
        video_path,
        last_frame_path.to_str().unwrap(),
        FramePosition::End,
    )
    .is_ok();

    // Generate thumbnails from the extracted frames
    let first_frame_thumbnail = if first_frame_ok && first_frame_path.exists() {
        generate_thumbnail_from_image(first_frame_path.to_str().unwrap()).ok()
    } else {
        None
    };

    let last_frame_thumbnail = if last_frame_ok && last_frame_path.exists() {
        generate_thumbnail_from_image(last_frame_path.to_str().unwrap()).ok()
    } else {
        None
    };

    Ok(ExtractedFrames {
        first_frame_thumbnail,
        last_frame_thumbnail,
        first_frame_path: if first_frame_ok {
            Some(first_frame_path.to_string_lossy().to_string())
        } else {
            None
        },
        last_frame_path: if last_frame_ok {
            Some(last_frame_path.to_string_lossy().to_string())
        } else {
            None
        },
    })
}

enum FramePosition {
    Start,
    End,
}

/// Extract a single frame from video at specified position using pure Rust crates
/// Uses: mp4parse (container) + openh264 (decoding)
fn extract_frame_at_position(
    video_path: &str,
    output_path: &str,
    position: FramePosition,
) -> Result<(), String> {
    use openh264::OpenH264API;
    use openh264::decoder::{Decoder, DecoderConfig, Flush};
    use openh264::formats::YUVSource;
    use std::fs::File;
    use std::io::{BufReader, Read, Seek, SeekFrom};

    let file = File::open(video_path).map_err(|e| format!("Failed to open video: {}", e))?;
    let mut reader = BufReader::new(file);

    // Parse MP4 container
    let context =
        mp4parse::read_mp4(&mut reader).map_err(|e| format!("Failed to parse MP4: {:?}", e))?;

    // Find video track
    let video_track = context
        .tracks
        .iter()
        .find(|t| t.track_type == mp4parse::TrackType::Video)
        .ok_or("No video track found")?;

    // Get sample count from stts
    let sample_count = match &video_track.stts {
        Some(stts) => stts.samples.iter().map(|e| e.sample_count).sum::<u32>(),
        None => return Err("No time-to-sample table".to_string()),
    };

    if sample_count == 0 {
        return Err("Video has no samples".to_string());
    }

    // Find sync samples (keyframes) from stss
    let sync_samples: Vec<u32> = match &video_track.stss {
        Some(stss) => stss.samples.iter().copied().collect(),
        None => {
            // If no stss, assume all samples are sync (rare for H.264)
            (1..=sample_count).collect()
        }
    };

    if sync_samples.is_empty() {
        return Err("No keyframes found".to_string());
    }

    // Get AVC decoder config (SPS/PPS from avcC box)
    let (sps_data, pps_data) = get_avc_config(video_track)?;

    // Initialize OpenH264 decoder with NoFlush to properly handle B-frame reordering.
    // The default Flush::Flush mode interferes with B-frame buffering in the decoder,
    // causing decode errors. We feed all samples and flush remaining frames at the end.
    let config = DecoderConfig::new().flush_after_decode(Flush::NoFlush);
    let mut decoder = Decoder::with_api_config(OpenH264API::from_source(), config)
        .map_err(|e| format!("Failed to create decoder: {:?}", e))?;

    // Feed SPS and PPS first (as Annex B format with start codes)
    let sps_annexb = add_start_code(&sps_data);
    let pps_annexb = add_start_code(&pps_data);

    decoder
        .decode(&sps_annexb)
        .map_err(|e| format!("Failed to decode SPS: {:?}", e))?;
    decoder
        .decode(&pps_annexb)
        .map_err(|e| format!("Failed to decode PPS: {:?}", e))?;

    // Determine which samples to decode based on position
    let (start_sample, end_sample) = match position {
        FramePosition::Start => {
            // For first frame: just decode the first keyframe
            let first_keyframe = sync_samples[0];
            (first_keyframe, first_keyframe)
        }
        FramePosition::End => {
            // For last frame: find the keyframe nearest to (but not after) the last sample,
            // then decode from there through all frames to the end
            let last_keyframe_before_end = sync_samples
                .iter()
                .filter(|&&s| s <= sample_count)
                .max()
                .copied()
                .unwrap_or(sync_samples[0]);
            (last_keyframe_before_end, sample_count)
        }
    };

    // Decode frames from start_sample to end_sample, keeping the last decoded frame
    let mut last_yuv_data: Option<(usize, usize, Vec<u8>)> = None;

    for sample_num in start_sample..=end_sample {
        let (sample_offset, sample_size) = get_sample_location(video_track, sample_num)?;

        reader
            .seek(SeekFrom::Start(sample_offset))
            .map_err(|e| format!("Failed to seek to sample: {}", e))?;
        let mut sample_data = vec![0u8; sample_size as usize];
        reader
            .read_exact(&mut sample_data)
            .map_err(|e| format!("Failed to read sample: {}", e))?;

        // Convert from AVCC format to Annex B
        let annexb_data = avcc_to_annexb(&sample_data)?;

        match decoder.decode(&annexb_data) {
            Ok(Some(yuv)) => {
                let (width, height) = yuv.dimensions();
                let rgb_len = width * height * 3;
                let mut rgb_data = vec![0u8; rgb_len];
                yuv.write_rgb8(&mut rgb_data);
                last_yuv_data = Some((width, height, rgb_data));
            }
            Ok(None) => {}
            Err(_) => continue,
        }
    }

    // Flush remaining frames from the decoder's reorder buffer
    if let Ok(remaining) = decoder.flush_remaining() {
        for yuv in &remaining {
            let (width, height) = yuv.dimensions();
            let rgb_len = width * height * 3;
            let mut rgb_data = vec![0u8; rgb_len];
            yuv.write_rgb8(&mut rgb_data);
            last_yuv_data = Some((width, height, rgb_data));
        }
    }

    // Use the last successfully decoded frame
    let (width, height, rgb_data) = last_yuv_data.ok_or("No frame decoded")?;

    // Save as JPEG
    let img = image::RgbImage::from_raw(width as u32, height as u32, rgb_data)
        .ok_or("Failed to create image from frame data")?;
    img.save(output_path)
        .map_err(|e| format!("Failed to save frame: {}", e))?;

    Ok(())
}

/// Get sample offset and size from MP4 track
fn get_sample_location(track: &mp4parse::Track, sample_number: u32) -> Result<(u64, u32), String> {
    // Get chunk offsets (stco)
    let chunk_offsets: Vec<u64> = match &track.stco {
        Some(stco) => stco.offsets.iter().copied().collect(),
        None => return Err("No chunk offset table".to_string()),
    };

    // Get sample sizes (stsz)
    let sample_sizes = match &track.stsz {
        Some(stsz) => &stsz.sample_sizes,
        None => return Err("No sample size table".to_string()),
    };

    // Get sample-to-chunk mapping (stsc)
    let stsc_entries = match &track.stsc {
        Some(stsc) => &stsc.samples,
        None => return Err("No sample-to-chunk table".to_string()),
    };

    // Find which chunk contains our sample
    let mut current_sample = 1u32;

    for (i, entry) in stsc_entries.iter().enumerate() {
        let first_chunk = entry.first_chunk;
        let samples_per_chunk = entry.samples_per_chunk;

        // Determine how many chunks this stsc entry covers
        let next_first_chunk = if i + 1 < stsc_entries.len() {
            stsc_entries[i + 1].first_chunk
        } else {
            chunk_offsets.len() as u32 + 1
        };

        let num_chunks = next_first_chunk - first_chunk;

        for chunk_in_entry in 0..num_chunks {
            let chunk_num = first_chunk + chunk_in_entry;
            let samples_in_chunk = samples_per_chunk;

            if sample_number >= current_sample && sample_number < current_sample + samples_in_chunk
            {
                // Found the chunk!
                let chunk_index = (chunk_num - 1) as usize;
                let sample_in_chunk = sample_number - current_sample;

                // Calculate offset within chunk
                let mut offset = chunk_offsets
                    .get(chunk_index)
                    .copied()
                    .ok_or("Chunk index out of bounds")?;

                for s in 0..sample_in_chunk {
                    let idx = (current_sample + s - 1) as usize;
                    if idx < sample_sizes.len() {
                        offset += sample_sizes[idx] as u64;
                    }
                }

                let size = sample_sizes
                    .get((sample_number - 1) as usize)
                    .copied()
                    .ok_or("Sample index out of bounds")?;

                return Ok((offset, size));
            }

            current_sample += samples_in_chunk;
        }
    }

    Err(format!("Sample {} not found", sample_number))
}

/// Extract SPS and PPS from avcC configuration box
fn get_avc_config(track: &mp4parse::Track) -> Result<(Vec<u8>, Vec<u8>), String> {
    // Look for avcC in the sample description
    if let Some(ref stsd) = track.stsd {
        for desc in &stsd.descriptions {
            if let mp4parse::SampleEntry::Video(video) = desc {
                match &video.codec_specific {
                    mp4parse::VideoCodecSpecific::AVCConfig(data) => {
                        return parse_avcc_data(data);
                    }
                    _ => continue,
                }
            }
        }
    }

    Err("No AVC configuration found".to_string())
}

/// Parse avcC box data to extract SPS and PPS
fn parse_avcc_data(data: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    if data.len() < 7 {
        return Err("avcC data too short".to_string());
    }

    // avcC structure:
    // [0] configurationVersion
    // [1] AVCProfileIndication
    // [2] profile_compatibility
    // [3] AVCLevelIndication
    // [4] lengthSizeMinusOne (lower 2 bits)
    // [5] numOfSequenceParameterSets (lower 5 bits)
    // Then SPS entries, then PPS entries

    let mut pos = 5;

    // Number of SPS (we only need the first one)
    let num_sps = (data[pos] & 0x1F) as usize;
    pos += 1;

    if num_sps == 0 {
        return Err("No SPS found".to_string());
    }

    // Read first SPS
    if pos + 2 > data.len() {
        return Err("Truncated SPS length".to_string());
    }
    let sps_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
    pos += 2;

    if pos + sps_len > data.len() {
        return Err("Truncated SPS data".to_string());
    }
    let sps_data = data[pos..pos + sps_len].to_vec();
    pos += sps_len;

    // Skip remaining SPS entries if any
    for _ in 1..num_sps {
        if pos + 2 > data.len() {
            return Err("Truncated SPS length".to_string());
        }
        let len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2 + len;
    }

    // Number of PPS
    if pos >= data.len() {
        return Err("No PPS count".to_string());
    }
    let num_pps = data[pos] as usize;
    pos += 1;

    if num_pps == 0 {
        return Err("No PPS found".to_string());
    }

    // Read first PPS
    if pos + 2 > data.len() {
        return Err("Truncated PPS length".to_string());
    }
    let pps_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
    pos += 2;

    if pos + pps_len > data.len() {
        return Err("Truncated PPS data".to_string());
    }
    let pps_data = data[pos..pos + pps_len].to_vec();

    Ok((sps_data, pps_data))
}

/// Convert AVCC format (length-prefixed NALUs) to Annex B format (start codes)
fn avcc_to_annexb(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut pos = 0;

    // AVCC uses 4-byte length prefix by default
    let length_size = 4;

    while pos + length_size <= data.len() {
        let nalu_len =
            u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        pos += length_size;

        if pos + nalu_len > data.len() {
            break; // Truncated, stop here
        }

        // Add Annex B start code
        result.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
        result.extend_from_slice(&data[pos..pos + nalu_len]);
        pos += nalu_len;
    }

    Ok(result)
}

/// Add Annex B start code to NAL unit
fn add_start_code(nalu: &[u8]) -> Vec<u8> {
    let mut result = vec![0x00, 0x00, 0x00, 0x01];
    result.extend_from_slice(nalu);
    result
}

/// Result of separating audio stems from a video
#[derive(Debug)]
struct SeparatedStems {
    vocals_path: Option<String>,
    bgm_path: Option<String>,
}

/// Extract audio from MP4 and separate into vocals and BGM using stem-splitter-core.
/// Only runs if the stem model has been downloaded via Settings.
/// Returns None-filled SeparatedStems on any failure (silent degradation).
fn separate_audio_stems(video_path: &str) -> Result<SeparatedStems, String> {
    use std::path::Path;

    // Skip if the model hasn't been downloaded yet
    if !is_stem_model_ready() {
        return Ok(SeparatedStems {
            vocals_path: None,
            bgm_path: None,
        });
    }

    let video_stem = Path::new(video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let video_dir = Path::new(video_path)
        .parent()
        .ok_or("Cannot get video directory")?;

    let vocals_path = video_dir.join(format!("{}_vocals.wav", video_stem));
    let bgm_path = video_dir.join(format!("{}_bgm.wav", video_stem));

    // Skip if already separated
    if vocals_path.exists() && bgm_path.exists() {
        return Ok(SeparatedStems {
            vocals_path: Some(vocals_path.to_string_lossy().to_string()),
            bgm_path: Some(bgm_path.to_string_lossy().to_string()),
        });
    }

    // Step 1: Extract audio from MP4 to a temporary WAV file
    let raw_audio_path = video_dir.join(format!("{}_audio_raw.wav", video_stem));
    extract_audio_from_mp4(video_path, raw_audio_path.to_str().unwrap())?;

    // Step 2: Use stem-splitter-core to separate vocals and accompaniment
    // Output to a temp directory, then move the files we need
    let output_dir = video_dir.join(format!("{}_stems", video_stem));
    let output_dir_str = output_dir.to_string_lossy().to_string();

    let options = stem_splitter_core::SplitOptions {
        output_dir: output_dir_str.clone(),
        ..Default::default()
    };

    let split_result = stem_splitter_core::split_file(raw_audio_path.to_str().unwrap(), options)
        .map_err(|e| format!("Stem separation failed: {:?}", e))?;

    // Step 3: Move separated stems to final paths and clean up
    // split_result contains the actual output paths
    if std::path::Path::new(&split_result.vocals_path).exists() {
        std::fs::rename(&split_result.vocals_path, &vocals_path)
            .map_err(|e| format!("Failed to move vocals: {}", e))?;
    }

    // Use "other" stem as BGM (contains accompaniment/music/effects)
    if std::path::Path::new(&split_result.other_path).exists() {
        std::fs::rename(&split_result.other_path, &bgm_path)
            .map_err(|e| format!("Failed to move bgm: {}", e))?;
    }

    // Clean up temporary files (raw audio, drums, bass, stems dir)
    let _ = std::fs::remove_file(&raw_audio_path);
    let _ = std::fs::remove_file(&split_result.drums_path);
    let _ = std::fs::remove_file(&split_result.bass_path);
    let _ = std::fs::remove_dir_all(&output_dir);

    Ok(SeparatedStems {
        vocals_path: if vocals_path.exists() {
            Some(vocals_path.to_string_lossy().to_string())
        } else {
            None
        },
        bgm_path: if bgm_path.exists() {
            Some(bgm_path.to_string_lossy().to_string())
        } else {
            None
        },
    })
}

/// Resample interleaved audio from one sample rate to another using linear interpolation.
fn resample_linear(samples: &[f32], channels: u16, from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ch = channels as usize;
    let in_frames = samples.len() / ch;
    let ratio = from_rate as f64 / to_rate as f64;
    let out_frames = (in_frames as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_frames * ch);

    for i in 0..out_frames {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;

        for c in 0..ch {
            let s0 = samples.get(idx * ch + c).copied().unwrap_or(0.0);
            let s1 = samples.get((idx + 1) * ch + c).copied().unwrap_or(s0);
            out.push(s0 + (s1 - s0) * frac);
        }
    }

    out
}

/// Extract audio track from an MP4 file and write it as a WAV file using symphonia + hound.
fn extract_audio_from_mp4(video_path: &str, output_wav_path: &str) -> Result<(), String> {
    use std::fs::File;
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = File::open(video_path)
        .map_err(|e| format!("Failed to open video for audio extraction: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp4");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe MP4: {}", e))?;

    let mut format_reader = probed.format;

    // Find the audio track by checking for known audio codecs
    let audio_track = format_reader
        .tracks()
        .iter()
        .find(|t| {
            let codec = t.codec_params.codec;
            codec == symphonia::core::codecs::CODEC_TYPE_AAC
                || codec == symphonia::core::codecs::CODEC_TYPE_MP3
                || codec == symphonia::core::codecs::CODEC_TYPE_VORBIS
                || codec == symphonia::core::codecs::CODEC_TYPE_FLAC
                || codec == symphonia::core::codecs::CODEC_TYPE_PCM_F32LE
                || codec == symphonia::core::codecs::CODEC_TYPE_PCM_S16LE
                || (codec != symphonia::core::codecs::CODEC_TYPE_NULL
                    && t.codec_params.channels.is_some()
                    && t.codec_params.sample_rate.is_some())
        })
        .ok_or("No audio track found in video")?;

    let track_id = audio_track.id;
    let codec_params = audio_track.codec_params.clone();

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create audio decoder: {}", e))?;

    // Collect all samples. Derive sample_rate/channels from the actual decoded
    // spec — container metadata can lie (e.g. AAC-HE/SBR reports base rate while
    // the decoder outputs at 2× after SBR upsampling), which caused vocals to
    // play back slowed down and pitched lower.
    let mut all_samples: Vec<f32> = Vec::new();
    let mut actual_rate: Option<u32> = None;
    let mut actual_channels: Option<u16> = None;

    loop {
        let packet = match format_reader.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let pkt_channels = spec.channels.count() as u16;

        // Lock in the true rate/channels from the first successful decode.
        // Skip packets whose spec changes mid-stream to keep the output coherent.
        match (actual_rate, actual_channels) {
            (None, None) => {
                actual_rate = Some(spec.rate);
                actual_channels = Some(pkt_channels);
            }
            (Some(r), Some(c)) if r != spec.rate || c != pkt_channels => continue,
            _ => {}
        }

        let num_frames = decoded.capacity();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        all_samples.extend_from_slice(sample_buf.samples());
    }

    if all_samples.is_empty() {
        return Err("No audio samples extracted from video".to_string());
    }

    let sample_rate = actual_rate.ok_or("Failed to determine decoded sample rate")?;
    let channels = actual_channels.ok_or("Failed to determine decoded channel count")?;

    // Resample to 44100 Hz if needed — stem-splitter-core expects 44.1kHz input
    // but does not resample internally, causing playback speed mismatch
    let target_rate = 44100u32;
    let (final_samples, final_rate) = if sample_rate != target_rate {
        (
            resample_linear(&all_samples, channels, sample_rate, target_rate),
            target_rate,
        )
    } else {
        (all_samples, sample_rate)
    };

    // Write WAV using hound
    let wav_spec = hound::WavSpec {
        channels,
        sample_rate: final_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::create(output_wav_path, wav_spec)
        .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

    for sample in &final_samples {
        writer
            .write_sample(*sample)
            .map_err(|e| format!("Failed to write WAV sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

    Ok(())
}

/// Generate a base64 thumbnail from an image file using image crate
fn generate_thumbnail_from_image(image_path: &str) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    let img = image::open(image_path).map_err(|e| format!("Failed to open image: {}", e))?;

    // Create thumbnail (max 200x200, maintains aspect ratio)
    let thumbnail = img.thumbnail(200, 200);

    // Encode as JPEG with quality 80 (same as image thumbnails)
    let mut buffer = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 80);
    thumbnail
        .write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let encoded = STANDARD.encode(buffer.into_inner());
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_separate_audio_stems() {
        let video_path = "/Users/allen/Pictures/AI-ArtStation/2026-04/video_e3a8b98e.mp4";
        if !std::path::Path::new(video_path).exists() {
            eprintln!("Test video not found, skipping");
            return;
        }

        // Clean up any previous test artifacts
        let dir = std::path::Path::new(video_path).parent().unwrap();
        let _ = std::fs::remove_file(dir.join("video_e3a8b98e_vocals.wav"));
        let _ = std::fs::remove_file(dir.join("video_e3a8b98e_bgm.wav"));

        let result = separate_audio_stems(video_path);
        println!("separate_audio_stems result: {:?}", result);
        match &result {
            Ok(stems) => {
                println!("vocals_path: {:?}", stems.vocals_path);
                println!("bgm_path: {:?}", stems.bgm_path);
            }
            Err(e) => {
                println!("ERROR: {}", e);
            }
        }
        assert!(result.is_ok(), "Stem separation failed: {:?}", result.err());
    }

    #[test]
    fn test_extract_audio_from_mp4() {
        let video_path = "/Users/allen/Pictures/AI-ArtStation/2026-04/video_e3a8b98e.mp4";
        if !std::path::Path::new(video_path).exists() {
            eprintln!("Test video not found, skipping");
            return;
        }

        let output_wav = "/tmp/test_audio_extract.wav";
        let _ = std::fs::remove_file(output_wav);

        let result = extract_audio_from_mp4(video_path, output_wav);
        println!("extract_audio_from_mp4 result: {:?}", result);
        assert!(
            result.is_ok(),
            "Audio extraction failed: {:?}",
            result.err()
        );
        assert!(
            std::path::Path::new(output_wav).exists(),
            "WAV file was not created"
        );

        let metadata = std::fs::metadata(output_wav).unwrap();
        println!("WAV file size: {} bytes", metadata.len());
        assert!(metadata.len() > 100, "WAV file is too small");

        let _ = std::fs::remove_file(output_wav);
    }
}
