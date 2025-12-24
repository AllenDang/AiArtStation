use crate::api::ApiClient;
use crate::commands::generation::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub base_url: String,
    pub api_token_set: bool, // Don't expose actual token
    pub image_model: String,
    pub video_model: String,
    pub output_directory: String,
    pub output_format: String,
    pub default_size: String,
    pub default_aspect_ratio: String,
    pub watermark: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveConfigRequest {
    pub base_url: String,
    pub api_token: String,
    pub image_model: String,
    pub video_model: String,
    pub output_directory: String,
    pub output_format: String,
}

#[tauri::command]
pub async fn load_settings(db_state: State<'_, DbState>) -> Result<ConfigResponse, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let config = db.load_config().map_err(|e| e.to_string())?;

    Ok(ConfigResponse {
        base_url: config.base_url,
        api_token_set: !config.api_token.is_empty(),
        image_model: config.image_model,
        video_model: config.video_model,
        output_directory: config.output_directory,
        output_format: config.output_format,
        default_size: config.default_size,
        default_aspect_ratio: config.default_aspect_ratio,
        watermark: config.watermark,
    })
}

#[tauri::command]
pub async fn save_settings(
    db_state: State<'_, DbState>,
    request: SaveConfigRequest,
) -> Result<(), String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;

    // Load existing config to preserve token if not provided
    let mut config = db.load_config().unwrap_or_default();

    config.base_url = request.base_url;
    // Only update token if a new one is provided
    if !request.api_token.is_empty() {
        config.api_token = request.api_token;
    }
    config.image_model = request.image_model;
    config.video_model = request.video_model;
    config.output_directory = request.output_directory;
    config.output_format = request.output_format;

    db.save_config(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn test_connection(db_state: State<'_, DbState>) -> Result<String, String> {
    // Extract config values before any await to avoid holding MutexGuard across await
    let (base_url, api_token) = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        let config = db.load_config().map_err(|e| e.to_string())?;
        (config.base_url, config.api_token)
    }; // MutexGuard is dropped here

    if base_url.is_empty() || api_token.is_empty() {
        return Err("Base URL and API Token are required".to_string());
    }

    let client = ApiClient::new(&base_url, &api_token)
        .map_err(|e| e.to_string())?;

    client.test_connection().await
        .map(|_| "Connection successful".to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_settings(db_state: State<'_, DbState>) -> Result<(), String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    db.delete_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_output_dir() -> String {
    dirs::picture_dir()
        .map(|p| p.join("AI-ArtStation"))
        .unwrap_or_else(|| std::path::PathBuf::from("./AI-ArtStation"))
        .to_string_lossy()
        .to_string()
}
