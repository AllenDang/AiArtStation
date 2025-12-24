use crate::api::{ApiClient, VideoContentItem, VideoGenerationRequest, VideoImageUrl};
use crate::commands::generation::DbState;
use crate::commands::settings::AppState;
use crate::storage::{VideoRecord, VideoStatusUpdate};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

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
    pub prompt: String,
    pub generation_type: String, // "text-to-video", "image-to-video-first", "image-to-video-both", "image-to-video-ref"
    pub first_frame: Option<String>,     // Base64
    pub last_frame: Option<String>,      // Base64
    pub reference_images: Option<Vec<String>>, // Base64 array for multi-ref
    pub resolution: Option<String>,      // "480p", "720p", "1080p"
    pub duration: Option<i32>,           // 2-12 seconds
    pub aspect_ratio: Option<String>,    // "16:9", "4:3", "1:1", etc.
    pub source_image_id: Option<String>, // Parent image ID if applicable
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
    app_state: State<'_, AppState>,
    db_state: State<'_, DbState>,
    request: GenerateVideoRequest,
) -> Result<GenerateVideoResponse, String> {
    // Load config
    let config = {
        let store = app_state.config_store.lock().map_err(|e| e.to_string())?;
        store.load().map_err(|e| e.to_string())?
    };

    if config.base_url.is_empty() || config.api_token.is_empty() || config.video_model.is_empty() {
        return Err("API configuration is incomplete. Please configure video model in settings.".to_string());
    }

    // Create API client
    let client = ApiClient::new(&config.base_url, &config.api_token)
        .map_err(|e| e.to_string())?;

    // Build prompt with parameters
    let mut prompt_with_params = request.prompt.clone();
    if let Some(ratio) = &request.aspect_ratio {
        prompt_with_params.push_str(&format!(" --ratio {}", ratio));
    }
    if let Some(dur) = request.duration {
        prompt_with_params.push_str(&format!(" --dur {}", dur));
    }
    if let Some(res) = &request.resolution {
        prompt_with_params.push_str(&format!(" --rs {}", res));
    }

    // Build content array
    let mut content = vec![VideoContentItem {
        content_type: "text".to_string(),
        text: Some(prompt_with_params),
        image_url: None,
        role: None,
    }];

    // Add images based on generation type
    match request.generation_type.as_str() {
        "image-to-video-first" => {
            if let Some(first_frame) = &request.first_frame {
                content.push(VideoContentItem {
                    content_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(VideoImageUrl {
                        url: first_frame.clone(),
                    }),
                    role: None, // No role for single first frame
                });
            }
        }
        "image-to-video-both" => {
            if let Some(first_frame) = &request.first_frame {
                content.push(VideoContentItem {
                    content_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(VideoImageUrl {
                        url: first_frame.clone(),
                    }),
                    role: Some("first_frame".to_string()),
                });
            }
            if let Some(last_frame) = &request.last_frame {
                content.push(VideoContentItem {
                    content_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(VideoImageUrl {
                        url: last_frame.clone(),
                    }),
                    role: Some("last_frame".to_string()),
                });
            }
        }
        "image-to-video-ref" => {
            if let Some(ref_images) = &request.reference_images {
                for img in ref_images {
                    content.push(VideoContentItem {
                        content_type: "image_url".to_string(),
                        text: None,
                        image_url: Some(VideoImageUrl {
                            url: img.clone(),
                        }),
                        role: Some("reference_image".to_string()),
                    });
                }
            }
        }
        _ => {} // text-to-video has no images
    }

    // Create video task
    let api_request = VideoGenerationRequest {
        model: config.video_model.clone(),
        content,
        service_tier: None, // Use default (online inference)
    };

    let response = client.create_video_task(api_request).await
        .map_err(|e| e.to_string())?;

    // Save to database
    let id = Uuid::new_v4().to_string();
    let record = VideoRecord {
        id: id.clone(),
        project_id: Some(request.project_id),
        task_id: response.id.clone(),
        file_path: None,
        first_frame_thumbnail: None,
        last_frame_thumbnail: None,
        first_frame_path: None,
        last_frame_path: None,
        prompt: request.prompt,
        model: config.video_model,
        generation_type: request.generation_type,
        source_image_id: request.source_image_id,
        resolution: request.resolution,
        duration: request.duration.map(|d| d as f64),
        fps: Some(24),
        aspect_ratio: request.aspect_ratio,
        status: "pending".to_string(),
        error_message: None,
        tokens_used: None,
        created_at: Utc::now(),
        completed_at: None,
        asset_types: Vec::new(),
    };

    {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        db.insert_video(&record).map_err(|e| e.to_string())?;
    }

    Ok(GenerateVideoResponse {
        id,
        task_id: response.id,
        status: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn poll_video_task(
    app_state: State<'_, AppState>,
    db_state: State<'_, DbState>,
    id: String,
) -> Result<Video, String> {
    // Get video record
    let record = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        db.get_video_by_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Video not found".to_string())?
    };

    // If already completed or failed, just return current status
    if record.status == "completed" || record.status == "failed" {
        return Ok(map_to_video(record));
    }

    // Load config
    let config = {
        let store = app_state.config_store.lock().map_err(|e| e.to_string())?;
        store.load().map_err(|e| e.to_string())?
    };

    // Create API client and poll
    let client = ApiClient::new(&config.base_url, &config.api_token)
        .map_err(|e| e.to_string())?;

    let status_response = client.get_video_task(&record.task_id).await
        .map_err(|e| e.to_string())?;

    // Map API status to our status
    let new_status = match status_response.status.as_str() {
        "queued" | "running" => "processing",
        "succeeded" => "completed",
        "failed" | "expired" => "failed",
        other => other,
    };

    // If status changed, update database
    if new_status != record.status {
        let downloaded = if new_status == "completed" {
            // Download video if completed
            if let Some(content) = &status_response.content {
                if let Some(video_url) = &content.video_url {
                    download_video(video_url, &config.output_directory, true)
                        .await
                        .ok()
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let error_message = if new_status == "failed" {
            status_response.error.as_ref().and_then(|e| e.message.clone())
        } else {
            None
        };

        let tokens_used = status_response.usage.as_ref().map(|u| u.total_tokens);

        {
            let db = db_state.database.lock().map_err(|e| e.to_string())?;
            let update = VideoStatusUpdate {
                status: new_status,
                file_path: downloaded.as_ref().map(|d| d.file_path.as_str()),
                first_frame_thumbnail: downloaded.as_ref().and_then(|d| d.first_frame_thumbnail.as_deref()),
                last_frame_thumbnail: downloaded.as_ref().and_then(|d| d.last_frame_thumbnail.as_deref()),
                first_frame_path: downloaded.as_ref().and_then(|d| d.first_frame_path.as_deref()),
                last_frame_path: downloaded.as_ref().and_then(|d| d.last_frame_path.as_deref()),
                resolution: status_response.resolution.as_deref(),
                duration: status_response.duration,
                fps: status_response.framespersecond,
                tokens_used,
                error_message: error_message.as_deref(),
            };
            db.update_video_status(&id, &update).map_err(|e| e.to_string())?;
        }
    }

    // Return updated record
    let updated_record = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        db.get_video_by_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Video not found".to_string())?
    };

    Ok(map_to_video(updated_record))
}

#[tauri::command]
pub async fn get_videos(
    db_state: State<'_, DbState>,
    project_id: String,
    page: i64,
    page_size: i64,
) -> Result<VideoGalleryResponse, String> {
    let offset = page * page_size;

    let (videos, total) = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
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
pub async fn get_video_detail(
    db_state: State<'_, DbState>,
    id: String,
) -> Result<Option<Video>, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let record = db.get_video_by_id(&id).map_err(|e| e.to_string())?;
    Ok(record.map(map_to_video))
}

#[tauri::command]
pub async fn get_pending_videos(db_state: State<'_, DbState>) -> Result<Vec<Video>, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let records = db.get_pending_videos().map_err(|e| e.to_string())?;
    Ok(records.into_iter().map(map_to_video).collect())
}

#[tauri::command]
pub async fn delete_video(
    db_state: State<'_, DbState>,
    id: String,
    delete_file: bool,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;

    if delete_file {
        if let Ok(Some(record)) = db.get_video_by_id(&id) {
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
        }
    }

    db.delete_video(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_video_tag(
    db_state: State<'_, DbState>,
    id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    db.add_video_asset_type(&id, &asset_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_video_tag(
    db_state: State<'_, DbState>,
    id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    db.remove_video_asset_type(&id, &asset_type).map_err(|e| e.to_string())
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
}

async fn download_video(url: &str, output_dir: &str, organize_by_date: bool) -> Result<DownloadedVideo, String> {
    use std::path::PathBuf;
    use chrono::Local;

    // Create output directory
    let mut path = PathBuf::from(output_dir);
    if organize_by_date {
        let date = Local::now().format("%Y-%m").to_string();
        path.push(&date);
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    // Generate filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let hash: String = uuid::Uuid::new_v4().to_string().chars().take(8).collect();
    let filename = format!("{}_{}.mp4", timestamp, hash);
    path.push(&filename);

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

    Ok(DownloadedVideo {
        file_path,
        first_frame_thumbnail: frames.as_ref().and_then(|f| f.first_frame_thumbnail.clone()),
        last_frame_thumbnail: frames.as_ref().and_then(|f| f.last_frame_thumbnail.clone()),
        first_frame_path: frames.as_ref().and_then(|f| f.first_frame_path.clone()),
        last_frame_path: frames.as_ref().and_then(|f| f.last_frame_path.clone()),
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
    let first_frame_ok = extract_frame_at_position(video_path, first_frame_path.to_str().unwrap(), FramePosition::Start).is_ok();

    // Extract last frame (near the end)
    let last_frame_ok = extract_frame_at_position(video_path, last_frame_path.to_str().unwrap(), FramePosition::End).is_ok();

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
        first_frame_path: if first_frame_ok { Some(first_frame_path.to_string_lossy().to_string()) } else { None },
        last_frame_path: if last_frame_ok { Some(last_frame_path.to_string_lossy().to_string()) } else { None },
    })
}

enum FramePosition {
    Start,
    End,
}

/// Extract a single frame from video at specified position using ffmpeg-next
fn extract_frame_at_position(video_path: &str, output_path: &str, position: FramePosition) -> Result<(), String> {
    use ffmpeg_next as ffmpeg;

    ffmpeg::init().map_err(|e| format!("Failed to init ffmpeg: {}", e))?;

    let mut ictx = ffmpeg::format::input(&video_path)
        .map_err(|e| format!("Failed to open video: {}", e))?;

    let video_stream_index = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .ok_or("No video stream found")?
        .index();

    let stream = ictx.stream(video_stream_index).ok_or("Failed to get stream")?;
    let time_base = stream.time_base();
    let duration = stream.duration();

    let codec_params = stream.parameters();
    let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .map_err(|e| format!("Failed to create codec context: {}", e))?;
    let mut decoder = decoder_ctx.decoder().video()
        .map_err(|e| format!("Failed to create video decoder: {}", e))?;

    // Calculate duration in seconds
    let duration_secs = if duration > 0 && time_base.numerator() > 0 {
        duration as f64 * time_base.numerator() as f64 / time_base.denominator() as f64
    } else {
        0.0
    };

    // For END position: seek to ~1 second before end, then decode to EOF to get actual last frame
    // For START position: seek to beginning
    const AV_TIME_BASE: i64 = 1_000_000;

    let (seek_ts, decode_to_eof) = match position {
        FramePosition::Start => {
            // Seek to beginning (0.1s to skip potential black frames)
            let ts = (0.1 * AV_TIME_BASE as f64) as i64;
            (ts, false)
        }
        FramePosition::End => {
            // Seek to ~1 second before end, then decode to EOF
            let seek_secs = (duration_secs - 1.0).max(0.0);
            let ts = (seek_secs * AV_TIME_BASE as f64) as i64;
            (ts, true)
        }
    };

    // Seek using FFI directly with AVSEEK_FLAG_BACKWARD
    let seek_result = unsafe {
        ffmpeg::ffi::avformat_seek_file(
            ictx.as_mut_ptr(),
            -1,
            i64::MIN,
            seek_ts,
            seek_ts,
            ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
        )
    };
    if seek_result < 0 {
        return Err(format!("Failed to seek: error code {}", seek_result));
    }

    let mut scaler: Option<ffmpeg::software::scaling::Context> = None;
    let mut last_good_frame: Option<(u32, u32, Vec<u8>)> = None;

    // Process packets
    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_index {
            continue;
        }

        decoder.send_packet(&packet)
            .map_err(|e| format!("Failed to send packet: {}", e))?;

        let mut decoded_frame = ffmpeg::frame::Video::empty();
        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            // Initialize scaler if needed
            if scaler.is_none() {
                scaler = Some(
                    ffmpeg::software::scaling::Context::get(
                        decoded_frame.format(),
                        decoded_frame.width(),
                        decoded_frame.height(),
                        ffmpeg::format::Pixel::RGB24,
                        decoded_frame.width(),
                        decoded_frame.height(),
                        ffmpeg::software::scaling::Flags::BILINEAR,
                    ).map_err(|e| format!("Failed to create scaler: {}", e))?
                );
            }

            // Convert to RGB
            let mut rgb_frame = ffmpeg::frame::Video::empty();
            scaler.as_mut().unwrap().run(&decoded_frame, &mut rgb_frame)
                .map_err(|e| format!("Failed to scale frame: {}", e))?;

            let width = rgb_frame.width();
            let height = rgb_frame.height();
            let data = rgb_frame.data(0).to_vec();

            // Keep this frame
            last_good_frame = Some((width, height, data));

            if !decode_to_eof {
                // For START: take first frame and exit immediately
                break;
            }
            // For END: continue decoding to get the actual last frame
        }

        if !decode_to_eof && last_good_frame.is_some() {
            break;
        }
    }

    // Flush decoder to get any remaining buffered frames
    if decode_to_eof {
        decoder.send_eof().ok();
        let mut decoded_frame = ffmpeg::frame::Video::empty();
        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            if let Some(ref mut s) = scaler {
                let mut rgb_frame = ffmpeg::frame::Video::empty();
                if s.run(&decoded_frame, &mut rgb_frame).is_ok() {
                    last_good_frame = Some((rgb_frame.width(), rgb_frame.height(), rgb_frame.data(0).to_vec()));
                }
            }
        }
    }

    // Save the last good frame
    if let Some((width, height, data)) = last_good_frame {
        let img = image::RgbImage::from_raw(width, height, data)
            .ok_or("Failed to create image from frame data")?;
        img.save(output_path)
            .map_err(|e| format!("Failed to save frame: {}", e))?;
        Ok(())
    } else {
        Err("No frame decoded".to_string())
    }
}

/// Generate a base64 thumbnail from an image file using image crate
fn generate_thumbnail_from_image(image_path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let img = image::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // Create thumbnail (max 200x200, maintains aspect ratio)
    let thumbnail = img.thumbnail(200, 200);

    // Encode as JPEG with quality 80 (same as image thumbnails)
    let mut buffer = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 80);
    thumbnail.write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let encoded = STANDARD.encode(buffer.into_inner());
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}
