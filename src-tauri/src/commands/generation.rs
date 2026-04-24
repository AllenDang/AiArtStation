use crate::image_processing::{
    create_thumbnail_base64, download_image, image_to_base64, save_image_bytes, smart_resize,
};
use crate::providers::{ProviderImageSource, ProviderRegistry, ReferenceMedia, RequestOptions};
use crate::storage::{Database, ImageRecord};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

/// Shared app state: database + provider registry.
pub struct AppState {
    pub db: Mutex<Database>,
    pub registry: ProviderRegistry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateImageRequest {
    pub project_id: String,
    pub provider_type: String,
    pub prompt: String,
    /// Base64 encoded reference images.
    pub reference_images: Vec<String>,
    /// Provider-specific parameters rendered from the manifest.
    pub params: Value,
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
    pub base64_preview: String,
}

#[tauri::command]
pub async fn generate_image(
    state: State<'_, AppState>,
    request: GenerateImageRequest,
) -> Result<GenerateImageResponse, String> {
    let (provider_record, output_directory) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let record = db
            .get_provider(&request.provider_type)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Provider 未配置".to_string())?;
        let settings = db.load_app_settings().map_err(|e| e.to_string())?;
        (record, settings.output_directory)
    };

    let model = provider_record
        .image_model
        .clone()
        .ok_or_else(|| "该 Provider 未配置图像模型".to_string())?;

    let provider = state
        .registry
        .get(&provider_record.provider_type)
        .ok_or_else(|| format!("未知的 Provider 类型: {}", provider_record.provider_type))?;

    let reference = ReferenceMedia {
        reference_images: request.reference_images.clone(),
        ..Default::default()
    };

    let options = RequestOptions {
        no_proxy: provider_record.no_proxy,
    };
    let output = provider
        .generate_image(
            &provider_record.credentials,
            &model,
            &request.prompt,
            &request.params,
            &reference,
            options,
        )
        .await
        .map_err(|e| e.to_string())?;

    let batch_id = if output.images.len() > 1 {
        Some(Uuid::new_v4().to_string())
    } else {
        None
    };

    let mut generated = Vec::new();
    for img in &output.images {
        let file_path = match &img.source {
            ProviderImageSource::Url(url) => download_image(url, &output_directory, true)
                .await
                .map_err(|e| e.to_string())?,
            ProviderImageSource::Bytes(bytes) => {
                save_image_bytes(bytes, &output_directory, true, None)
                    .await
                    .map_err(|e| e.to_string())?
            }
        };
        let file_bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
        let base64_preview = image_to_base64(&file_bytes).map_err(|e| e.to_string())?;
        let thumbnail = create_thumbnail_base64(&file_bytes, 200).ok();

        let id = Uuid::new_v4().to_string();
        // Prefer the per-image size returned by the provider; fall back to the
        // request-level size metadata.
        let size = img
            .size
            .clone()
            .unwrap_or_else(|| output.metadata.size.clone());

        let record = ImageRecord {
            id: id.clone(),
            project_id: Some(request.project_id.clone()),
            batch_id: batch_id.clone(),
            file_path: file_path.clone(),
            thumbnail,
            prompt: request.prompt.clone(),
            provider_type: Some(provider_record.provider_type.clone()),
            model: model.clone(),
            size: size.clone(),
            aspect_ratio: output.metadata.aspect_ratio.clone(),
            generation_type: output.metadata.generation_type.clone(),
            reference_images: request.reference_images.clone(),
            tokens_used: output.tokens_used,
            created_at: Utc::now(),
            asset_types: vec![],
        };

        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            db.insert_image(&record).map_err(|e| e.to_string())?;
        }

        generated.push(GeneratedImageInfo {
            id,
            file_path,
            size,
            base64_preview,
        });
    }

    Ok(GenerateImageResponse {
        images: generated,
        tokens_used: output.tokens_used,
    })
}

#[tauri::command]
pub async fn prepare_reference_image(file_path: String) -> Result<PreparedImage, String> {
    let data = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let result = smart_resize(&data).map_err(|e| e.to_string())?;
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
