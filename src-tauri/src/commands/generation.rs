use crate::api::{ApiClient, ImageGenerationRequest};
use crate::commands::settings::AppState;
use crate::image_processing::{create_thumbnail_base64, download_image, image_to_base64, smart_resize};
use crate::storage::{Database, ImageRecord};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

pub struct DbState {
    pub database: Mutex<Database>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateImageRequest {
    pub project_id: String,
    pub prompt: String,
    pub reference_images: Vec<String>, // Base64 encoded images
    pub size: Option<String>,
    pub aspect_ratio: Option<String>,
    pub watermark: Option<bool>,
    // Batch/sequential generation
    pub sequential_generation: Option<bool>,
    pub max_images: Option<i32>,
    // Prompt optimization
    pub optimize_prompt: Option<bool>,
    pub optimize_prompt_mode: Option<String>, // "standard" or "fast"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateImageResponse {
    pub images: Vec<GeneratedImageInfo>,
    pub tokens_used: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImageInfo {
    pub id: String,
    pub file_path: String,
    pub size: String,
    pub base64_preview: String, // For immediate display
}

#[tauri::command]
pub async fn generate_image(
    app_state: State<'_, AppState>,
    db_state: State<'_, DbState>,
    request: GenerateImageRequest,
) -> Result<GenerateImageResponse, String> {
    // Load config
    let config = {
        let store = app_state.config_store.lock().map_err(|e| e.to_string())?;
        store.load().map_err(|e| e.to_string())?
    };

    if config.base_url.is_empty() || config.api_token.is_empty() || config.image_model.is_empty() {
        return Err("API configuration is incomplete. Please configure settings first.".to_string());
    }

    // Create API client
    let client = ApiClient::new(&config.base_url, &config.api_token)
        .map_err(|e| e.to_string())?;

    // Build API request
    let mut api_request = if request.reference_images.is_empty() {
        ImageGenerationRequest::text_to_image(&config.image_model, &request.prompt)
    } else if request.reference_images.len() == 1 {
        ImageGenerationRequest::image_to_image(
            &config.image_model,
            &request.prompt,
            &request.reference_images[0],
        )
    } else {
        ImageGenerationRequest::multi_image_fusion(
            &config.image_model,
            &request.prompt,
            request.reference_images.clone(),
        )
    };

    // Apply options
    if let Some(size) = &request.size {
        api_request = api_request.with_size(size);
    } else {
        api_request = api_request.with_size(&config.default_size);
    }

    if let Some(watermark) = request.watermark {
        api_request = api_request.with_watermark(watermark);
    } else {
        api_request = api_request.with_watermark(config.watermark);
    }

    // Batch/sequential generation
    if request.sequential_generation.unwrap_or(false) {
        let max = request.max_images.unwrap_or(3);
        api_request = api_request.with_batch(max);
    }

    // Prompt optimization
    if request.optimize_prompt.unwrap_or(false) {
        let mode = request.optimize_prompt_mode.as_deref().unwrap_or("standard");
        api_request = api_request.with_optimize_prompt(mode);
    }

    // Call API
    let response = client.generate_images(api_request).await
        .map_err(|e| e.to_string())?;

    // Process results
    let mut generated_images = Vec::new();
    let generation_type = if request.reference_images.is_empty() {
        "text-to-image"
    } else if request.reference_images.len() == 1 {
        "image-to-image"
    } else {
        "multi-fusion"
    };

    // Generate batch_id if multiple images (sequential generation)
    let batch_id = if response.data.len() > 1 {
        Some(Uuid::new_v4().to_string())
    } else {
        None
    };

    for img_data in &response.data {
        if let Some(url) = &img_data.url {
            // Download image (always organize by date)
            let file_path = download_image(
                url,
                &config.output_directory,
                true,
            ).await.map_err(|e| e.to_string())?;

            // Read file for base64 preview and thumbnail
            let file_bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
            let base64_preview = image_to_base64(&file_bytes).map_err(|e| e.to_string())?;

            // Generate thumbnail for fast gallery loading (200x200)
            let thumbnail = create_thumbnail_base64(&file_bytes, 200).ok();

            let id = Uuid::new_v4().to_string();
            let size = img_data.size.clone().unwrap_or_default();

            // Save to database
            let record = ImageRecord {
                id: id.clone(),
                project_id: Some(request.project_id.clone()),
                batch_id: batch_id.clone(),
                file_path: file_path.clone(),
                thumbnail,
                prompt: request.prompt.clone(),
                model: config.image_model.clone(),
                size: size.clone(),
                aspect_ratio: request.aspect_ratio.clone().unwrap_or_default(),
                generation_type: generation_type.to_string(),
                reference_images: request.reference_images.clone(),
                tokens_used: response.usage.total_tokens,
                created_at: Utc::now(),
                asset_types: vec![], // Images start untagged
            };

            {
                let db = db_state.database.lock().map_err(|e| e.to_string())?;
                db.insert_image(&record).map_err(|e| e.to_string())?;
            }

            generated_images.push(GeneratedImageInfo {
                id,
                file_path,
                size,
                base64_preview,
            });
        }
    }

    Ok(GenerateImageResponse {
        images: generated_images,
        tokens_used: response.usage.total_tokens,
    })
}

#[tauri::command]
pub async fn prepare_reference_image(file_path: String) -> Result<PreparedImage, String> {
    // Read file
    let data = std::fs::read(&file_path).map_err(|e| e.to_string())?;

    // Smart resize
    let result = smart_resize(&data).map_err(|e| e.to_string())?;

    // Convert to base64
    let base64 = image_to_base64(&result.data).map_err(|e| e.to_string())?;

    Ok(PreparedImage {
        base64,
        width: result.width,
        height: result.height,
        was_resized: result.was_resized,
        original_width: result.original_width,
        original_height: result.original_height,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedImage {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub was_resized: bool,
    pub original_width: u32,
    pub original_height: u32,
}
