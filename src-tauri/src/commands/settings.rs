use crate::commands::generation::AppState;
use crate::providers::ProviderDescriptor;
use crate::storage::AppSettings;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

// ============================================================================
// Provider Descriptors (static info about registered provider types)
// ============================================================================

#[tauri::command]
pub async fn list_provider_types(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderDescriptor>, String> {
    Ok(state.registry.descriptors())
}

// ============================================================================
// Provider instances CRUD (single instance per type — provider_type is the id)
// ============================================================================

/// A provider row as surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInstance {
    pub provider_type: String,
    pub credentials: HashMap<String, String>,
    pub image_model: Option<String>,
    pub video_model: Option<String>,
    #[serde(default)]
    pub no_proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveProviderRequest {
    pub provider_type: String,
    /// If a secret field is empty, the existing stored value is preserved so
    /// users don't have to re-enter the secret every time they edit.
    pub credentials: HashMap<String, String>,
    pub image_model: Option<String>,
    pub video_model: Option<String>,
    #[serde(default)]
    pub no_proxy: bool,
}

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> Result<Vec<ProviderInstance>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.list_providers().map_err(|e| e.to_string())?;
    Ok(records
        .into_iter()
        .map(|r| ProviderInstance {
            provider_type: r.provider_type,
            credentials: r.credentials,
            image_model: r.image_model,
            video_model: r.video_model,
            no_proxy: r.no_proxy,
        })
        .collect())
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    request: SaveProviderRequest,
) -> Result<ProviderInstance, String> {
    let provider = state
        .registry
        .get(&request.provider_type)
        .ok_or_else(|| format!("未知的 Provider 类型: {}", request.provider_type))?;
    let caps = provider.capabilities();

    // Normalize models: blank string → None; and clear any model for a
    // capability the provider doesn't support.
    let image_model = request
        .image_model
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && caps.image);
    let video_model = request
        .video_model
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && caps.video);

    if image_model.is_none() && video_model.is_none() {
        return Err("请至少配置图像或视频模型".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Merge credentials with existing so unchanged secrets aren't wiped.
    let (merged_credentials, created_at) = match db
        .get_provider(&request.provider_type)
        .map_err(|e| e.to_string())?
    {
        Some(existing) => {
            let mut merged = existing.credentials.clone();
            for (k, v) in &request.credentials {
                if !v.is_empty() {
                    merged.insert(k.clone(), v.clone());
                }
            }
            (merged, existing.created_at)
        }
        None => (request.credentials.clone(), Utc::now()),
    };

    let record = crate::storage::ProviderRecord {
        provider_type: request.provider_type.clone(),
        credentials: merged_credentials.clone(),
        image_model: image_model.clone(),
        video_model: video_model.clone(),
        no_proxy: request.no_proxy,
        created_at,
    };
    db.save_provider(&record).map_err(|e| e.to_string())?;

    // Auto-assign as default if no default set yet for the relevant capability.
    let mut settings = db.load_app_settings().map_err(|e| e.to_string())?;
    let mut mutated = false;
    if image_model.is_some() && settings.default_image_provider_type.is_none() {
        settings.default_image_provider_type = Some(request.provider_type.clone());
        mutated = true;
    }
    if video_model.is_some() && settings.default_video_provider_type.is_none() {
        settings.default_video_provider_type = Some(request.provider_type.clone());
        mutated = true;
    }
    if mutated {
        db.save_app_settings(&settings).map_err(|e| e.to_string())?;
    }

    Ok(ProviderInstance {
        provider_type: request.provider_type,
        credentials: merged_credentials,
        image_model,
        video_model,
        no_proxy: request.no_proxy,
    })
}

#[tauri::command]
pub async fn delete_provider(
    state: State<'_, AppState>,
    provider_type: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_provider(&provider_type)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    provider_type: String,
    credentials: HashMap<String, String>,
    no_proxy: Option<bool>,
) -> Result<(), String> {
    let provider = state
        .registry
        .get(&provider_type)
        .ok_or_else(|| format!("未知的 Provider 类型: {}", provider_type))?;

    // Merge with stored credentials so a blank secret in the form means
    // "use the existing secret" rather than testing with empty.
    let merged = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        match db.get_provider(&provider_type).map_err(|e| e.to_string())? {
            Some(existing) => {
                let mut m = existing.credentials;
                for (k, v) in &credentials {
                    if !v.is_empty() {
                        m.insert(k.clone(), v.clone());
                    }
                }
                m
            }
            None => credentials,
        }
    };

    let options = crate::providers::RequestOptions {
        no_proxy: no_proxy.unwrap_or(false),
    };
    provider
        .test_connection(&merged, options)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// App Settings
// ============================================================================

#[tauri::command]
pub async fn load_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.load_app_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_app_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_app_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_output_dir() -> String {
    crate::storage::get_default_output_dir()
}
