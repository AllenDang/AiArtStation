use crate::api::{ApiClient, VideoContentItem, VideoGenerationRequest, VideoImageUrl};
use crate::commands::generation::DbState;
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
    db_state: State<'_, DbState>,
    request: GenerateVideoRequest,
) -> Result<GenerateVideoResponse, String> {
    // Load config
    let config = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        db.load_config().map_err(|e| e.to_string())?
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
    db_state: State<'_, DbState>,
    id: String,
) -> Result<Video, String> {
    // Get video record and config
    let (record, config) = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        let record = db.get_video_by_id(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Video not found".to_string())?;
        let config = db.load_config().map_err(|e| e.to_string())?;
        (record, config)
    };

    // If already completed or failed, just return current status
    if record.status == "completed" || record.status == "failed" {
        return Ok(map_to_video(record));
    }

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
                    download_video(video_url, &config.output_directory, &id, true)
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
pub async fn get_videos_by_asset_type(
    db_state: State<'_, DbState>,
    project_id: String,
    asset_type: String,
    page: i64,
    page_size: i64,
) -> Result<VideoGalleryResponse, String> {
    let offset = page * page_size;

    let (videos, total) = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
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

async fn download_video(url: &str, output_dir: &str, video_id: &str, organize_by_date: bool) -> Result<DownloadedVideo, String> {
    use std::path::PathBuf;
    use chrono::Local;

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
        return Ok(DownloadedVideo {
            file_path,
            first_frame_thumbnail: frames.as_ref().and_then(|f| f.first_frame_thumbnail.clone()),
            last_frame_thumbnail: frames.as_ref().and_then(|f| f.last_frame_thumbnail.clone()),
            first_frame_path: frames.as_ref().and_then(|f| f.first_frame_path.clone()),
            last_frame_path: frames.as_ref().and_then(|f| f.last_frame_path.clone()),
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

/// Extract a single frame from video at specified position using pure Rust crates
/// Uses: mp4parse (container) + openh264 (decoding)
fn extract_frame_at_position(video_path: &str, output_path: &str, position: FramePosition) -> Result<(), String> {
    use std::fs::File;
    use std::io::{BufReader, Read, Seek, SeekFrom};
    use openh264::decoder::Decoder;
    use openh264::formats::YUVSource;

    let file = File::open(video_path).map_err(|e| format!("Failed to open video: {}", e))?;
    let mut reader = BufReader::new(file);

    // Parse MP4 container
    let context = mp4parse::read_mp4(&mut reader)
        .map_err(|e| format!("Failed to parse MP4: {:?}", e))?;

    // Find video track
    let video_track = context.tracks.iter()
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

    // Initialize OpenH264 decoder
    let mut decoder = Decoder::new()
        .map_err(|e| format!("Failed to create decoder: {:?}", e))?;

    // Feed SPS and PPS first (as Annex B format with start codes)
    let sps_annexb = add_start_code(&sps_data);
    let pps_annexb = add_start_code(&pps_data);

    decoder.decode(&sps_annexb).map_err(|e| format!("Failed to decode SPS: {:?}", e))?;
    decoder.decode(&pps_annexb).map_err(|e| format!("Failed to decode PPS: {:?}", e))?;

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
            let last_keyframe_before_end = sync_samples.iter()
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
        // Get sample offset and size
        let (sample_offset, sample_size) = get_sample_location(video_track, sample_num)?;

        // Read the sample data
        reader.seek(SeekFrom::Start(sample_offset))
            .map_err(|e| format!("Failed to seek to sample: {}", e))?;
        let mut sample_data = vec![0u8; sample_size as usize];
        reader.read_exact(&mut sample_data)
            .map_err(|e| format!("Failed to read sample: {}", e))?;

        // Convert sample from AVCC format (length-prefixed) to Annex B (start codes)
        let annexb_data = avcc_to_annexb(&sample_data)?;

        // Decode the frame
        let decoded = decoder.decode(&annexb_data)
            .map_err(|e| format!("Failed to decode frame {}: {:?}", sample_num, e))?;

        // Store the decoded frame if we got one
        if let Some(yuv) = decoded {
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

            if sample_number >= current_sample && sample_number < current_sample + samples_in_chunk {
                // Found the chunk!
                let chunk_index = (chunk_num - 1) as usize;
                let sample_in_chunk = sample_number - current_sample;

                // Calculate offset within chunk
                let mut offset = chunk_offsets.get(chunk_index)
                    .copied()
                    .ok_or("Chunk index out of bounds")?;

                for s in 0..sample_in_chunk {
                    let idx = (current_sample + s - 1) as usize;
                    if idx < sample_sizes.len() {
                        offset += sample_sizes[idx] as u64;
                    }
                }

                let size = sample_sizes.get((sample_number - 1) as usize)
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
            if let mp4parse::SampleEntry::Video(ref video) = desc {
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
        let nalu_len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
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
