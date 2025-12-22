use crate::api::ApiClient;
use crate::storage::ConfigStore;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config_store: Mutex<ConfigStore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub base_url: String,
    pub api_token_set: bool, // Don't expose actual token
    pub image_model: String,
    pub video_model: String,
    pub output_directory: String,
    pub output_format: String,
    pub organize_by_date: bool,
    pub save_metadata: bool,
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
    pub organize_by_date: bool,
    pub save_metadata: bool,
    pub default_size: String,
    pub default_aspect_ratio: String,
    pub watermark: bool,
}

#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> Result<ConfigResponse, String> {
    let store = state.config_store.lock().map_err(|e| e.to_string())?;
    let config = store.load().map_err(|e| e.to_string())?;

    Ok(ConfigResponse {
        base_url: config.base_url,
        api_token_set: !config.api_token.is_empty(),
        image_model: config.image_model,
        video_model: config.video_model,
        output_directory: config.output_directory,
        output_format: config.output_format,
        organize_by_date: config.organize_by_date,
        save_metadata: config.save_metadata,
        default_size: config.default_size,
        default_aspect_ratio: config.default_aspect_ratio,
        watermark: config.watermark,
    })
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    request: SaveConfigRequest,
) -> Result<(), String> {
    let store = state.config_store.lock().map_err(|e| e.to_string())?;

    // Load existing config to preserve token if not provided
    let mut config = store.load().unwrap_or_default();

    config.base_url = request.base_url;
    // Only update token if a new one is provided
    if !request.api_token.is_empty() {
        config.api_token = request.api_token;
    }
    config.image_model = request.image_model;
    config.video_model = request.video_model;
    config.output_directory = request.output_directory;
    config.output_format = request.output_format;
    config.organize_by_date = request.organize_by_date;
    config.save_metadata = request.save_metadata;
    config.default_size = request.default_size;
    config.default_aspect_ratio = request.default_aspect_ratio;
    config.watermark = request.watermark;

    store.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn test_connection(state: State<'_, AppState>) -> Result<String, String> {
    // Extract config values before any await to avoid holding MutexGuard across await
    let (base_url, api_token) = {
        let store = state.config_store.lock().map_err(|e| e.to_string())?;
        let config = store.load().map_err(|e| e.to_string())?;
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
pub async fn clear_settings(state: State<'_, AppState>) -> Result<(), String> {
    let store = state.config_store.lock().map_err(|e| e.to_string())?;
    store.delete().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_output_dir() -> String {
    dirs::picture_dir()
        .map(|p| p.join("AI-ArtStation"))
        .unwrap_or_else(|| std::path::PathBuf::from("./AI-ArtStation"))
        .to_string_lossy()
        .to_string()
}
