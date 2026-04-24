use crate::commands::generation::AppState;
use crate::image_processing::image_to_base64;
use crate::storage::AssetRecord;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub asset_type: String,
    pub tags: Vec<String>,
    pub file_path: String,
    pub thumbnail: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssetRequest {
    pub project_id: String,
    pub name: String,
    pub asset_type: String, // "character", "background", "style", "prop"
    pub tags: Vec<String>,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAssetRequest {
    pub name: String,
    pub asset_type: String,
    pub tags: Vec<String>,
}

#[tauri::command]
pub async fn create_asset(
    state: State<'_, AppState>,
    request: CreateAssetRequest,
) -> Result<Asset, String> {
    // Generate thumbnail from file
    let thumbnail = generate_thumbnail(&request.file_path).ok();

    let record = AssetRecord {
        id: Uuid::new_v4().to_string(),
        project_id: request.project_id,
        name: request.name,
        asset_type: request.asset_type,
        tags: request.tags,
        file_path: request.file_path,
        thumbnail,
        created_at: Utc::now(),
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.insert_asset(&record).map_err(|e| e.to_string())?;

    Ok(Asset {
        id: record.id,
        project_id: record.project_id,
        name: record.name,
        asset_type: record.asset_type,
        tags: record.tags,
        file_path: record.file_path,
        thumbnail: record.thumbnail,
        created_at: record.created_at.to_rfc3339(),
    })
}

#[tauri::command]
pub async fn get_assets(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Asset>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db
        .get_assets_by_project(&project_id)
        .map_err(|e| e.to_string())?;

    let assets: Vec<Asset> = records
        .into_iter()
        .map(|record| Asset {
            id: record.id,
            project_id: record.project_id,
            name: record.name,
            asset_type: record.asset_type,
            tags: record.tags,
            file_path: record.file_path,
            thumbnail: record.thumbnail,
            created_at: record.created_at.to_rfc3339(),
        })
        .collect();

    Ok(assets)
}

#[tauri::command]
pub async fn update_asset(
    state: State<'_, AppState>,
    id: String,
    request: UpdateAssetRequest,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_asset(&id, &request.name, &request.asset_type, &request.tags)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_asset(
    state: State<'_, AppState>,
    id: String,
    delete_file: bool,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Optionally delete the file
    if delete_file {
        if let Ok(Some(asset)) = db.get_asset_by_id(&id) {
            let _ = std::fs::remove_file(&asset.file_path);
        }
    }

    db.delete_asset(&id).map_err(|e| e.to_string())
}

fn generate_thumbnail(file_path: &str) -> Result<String, String> {
    let data = std::fs::read(file_path).map_err(|e| e.to_string())?;

    let img = image::load_from_memory(&data).map_err(|e| e.to_string())?;
    let thumbnail = img.thumbnail(150, 150);

    let mut buffer = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    image_to_base64(&buffer.into_inner()).map_err(|e| e.to_string())
}
