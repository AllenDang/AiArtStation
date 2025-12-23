use crate::commands::generation::DbState;
use crate::image_processing::{create_thumbnail_base64, image_to_base64};
use crate::storage::ImageRecord;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryImage {
    pub id: String,
    pub project_id: Option<String>,
    pub batch_id: Option<String>, // Groups sequential images together
    pub file_path: String,
    pub prompt: String,
    pub model: String,
    pub size: String,
    pub aspect_ratio: String,
    pub generation_type: String,
    pub tokens_used: i64,
    pub created_at: String,
    pub thumbnail: Option<String>, // Base64 thumbnail
    pub asset_types: Vec<String>, // ["character", "background", "style", "prop"] - multiple tags allowed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetTypeCounts {
    pub character: i64,
    pub background: i64,
    pub style: i64,
    pub prop: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryResponse {
    pub images: Vec<GalleryImage>,
    pub total: i64,
    pub has_more: bool,
}

#[tauri::command]
pub async fn get_gallery(
    db_state: State<'_, DbState>,
    project_id: String,
    page: i64,
    page_size: i64,
    include_thumbnails: bool,
) -> Result<GalleryResponse, String> {
    let offset = page * page_size;

    let (images, total) = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        let images = db
            .get_images_by_project(&project_id, page_size, offset)
            .map_err(|e| e.to_string())?;
        let total = db
            .get_image_count(Some(&project_id))
            .map_err(|e| e.to_string())?;
        (images, total)
    };

    let gallery_images: Vec<GalleryImage> = images
        .into_iter()
        .map(|record| map_to_gallery_image(record, include_thumbnails))
        .collect();

    let has_more = (offset + page_size) < total;

    Ok(GalleryResponse {
        images: gallery_images,
        total,
        has_more,
    })
}

#[tauri::command]
pub async fn search_gallery(
    db_state: State<'_, DbState>,
    query: String,
    limit: i64,
) -> Result<Vec<GalleryImage>, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let images = db.search_images(&query, limit).map_err(|e| e.to_string())?;

    let gallery_images: Vec<GalleryImage> = images
        .into_iter()
        .map(|record| map_to_gallery_image(record, true)) // Include thumbnails
        .collect();

    Ok(gallery_images)
}

#[tauri::command]
pub async fn get_image_detail(
    db_state: State<'_, DbState>,
    id: String,
) -> Result<Option<GalleryImage>, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let record = db.get_image_by_id(&id).map_err(|e| e.to_string())?;

    Ok(record.map(|r| map_to_gallery_image(r, false)))
}

#[tauri::command]
pub async fn delete_gallery_image(
    db_state: State<'_, DbState>,
    id: String,
    delete_file: bool,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;

    // Get file path before deleting
    if delete_file {
        if let Ok(Some(record)) = db.get_image_by_id(&id) {
            // Delete image file
            let _ = std::fs::remove_file(&record.file_path);
            // Delete metadata file if exists
            let metadata_path = format!("{}.json", record.file_path.trim_end_matches(".jpg").trim_end_matches(".png"));
            let _ = std::fs::remove_file(&metadata_path);
        }
    }

    db.delete_image(&id).map_err(|e| e.to_string())
}

/// Regenerate thumbnails for images that don't have them cached.
/// Returns the number of images updated.
#[tauri::command]
pub async fn regenerate_thumbnails(
    db_state: State<'_, DbState>,
) -> Result<u32, String> {
    let images = {
        let db = db_state.database.lock().map_err(|e| e.to_string())?;
        db.get_images_without_thumbnails(100).map_err(|e| e.to_string())?
    };

    let mut updated = 0u32;
    for image in images {
        // Read the image file
        if let Ok(data) = std::fs::read(&image.file_path) {
            // Generate thumbnail
            if let Ok(thumbnail) = create_thumbnail_base64(&data, 200) {
                // Update database
                let db = db_state.database.lock().map_err(|e| e.to_string())?;
                if db.update_image_thumbnail(&image.id, &thumbnail).map_err(|e| e.to_string())? {
                    updated += 1;
                }
            }
        }
    }

    Ok(updated)
}

/// Add an asset type tag to an image
#[tauri::command]
pub async fn add_image_tag(
    db_state: State<'_, DbState>,
    image_id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    db.add_image_asset_type(&image_id, &asset_type)
        .map_err(|e| e.to_string())
}

/// Remove an asset type tag from an image
#[tauri::command]
pub async fn remove_image_tag(
    db_state: State<'_, DbState>,
    image_id: String,
    asset_type: String,
) -> Result<bool, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    db.remove_image_asset_type(&image_id, &asset_type)
        .map_err(|e| e.to_string())
}

/// Get counts of images by asset type for a project
#[tauri::command]
pub async fn get_asset_type_counts(
    db_state: State<'_, DbState>,
    project_id: String,
) -> Result<AssetTypeCounts, String> {
    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let counts = db.get_asset_type_counts(&project_id).map_err(|e| e.to_string())?;

    // Convert Vec<(String, i64)> to AssetTypeCounts struct
    let mut result = AssetTypeCounts {
        character: 0,
        background: 0,
        style: 0,
        prop: 0,
    };

    for (asset_type, count) in counts {
        match asset_type.as_str() {
            "character" => result.character = count,
            "background" => result.background = count,
            "style" => result.style = count,
            "prop" => result.prop = count,
            _ => {}
        }
    }

    Ok(result)
}

/// Get images filtered by asset type
#[tauri::command]
pub async fn get_gallery_by_asset_type(
    db_state: State<'_, DbState>,
    project_id: String,
    asset_type: String,
    page: i64,
    page_size: i64,
    include_thumbnails: bool,
) -> Result<GalleryResponse, String> {
    let offset = page * page_size;

    let db = db_state.database.lock().map_err(|e| e.to_string())?;
    let images = db
        .get_images_by_asset_type(&project_id, &asset_type, page_size, offset)
        .map_err(|e| e.to_string())?;

    let total = images.len() as i64; // For filtered views, we'll use actual count

    let gallery_images: Vec<GalleryImage> = images
        .into_iter()
        .map(|record| map_to_gallery_image(record, include_thumbnails))
        .collect();

    let has_more = gallery_images.len() as i64 >= page_size;

    Ok(GalleryResponse {
        images: gallery_images,
        total,
        has_more,
    })
}

fn map_to_gallery_image(record: ImageRecord, include_thumbnail: bool) -> GalleryImage {
    // Use cached thumbnail from database (instant load)
    // Only fall back to on-the-fly generation for old images without cached thumbnails
    let thumbnail = if include_thumbnail {
        record.thumbnail.or_else(|| load_thumbnail_fallback(&record.file_path).ok())
    } else {
        None
    };

    GalleryImage {
        id: record.id,
        project_id: record.project_id,
        batch_id: record.batch_id,
        file_path: record.file_path,
        prompt: record.prompt,
        model: record.model,
        size: record.size,
        aspect_ratio: record.aspect_ratio,
        generation_type: record.generation_type,
        tokens_used: record.tokens_used,
        created_at: record.created_at.to_rfc3339(),
        thumbnail,
        asset_types: record.asset_types,
    }
}

/// Fallback for old images that don't have cached thumbnails
fn load_thumbnail_fallback(file_path: &str) -> Result<String, String> {
    let data = std::fs::read(file_path).map_err(|e| e.to_string())?;

    // Create small thumbnail
    let img = image::load_from_memory(&data).map_err(|e| e.to_string())?;
    let thumbnail = img.thumbnail(200, 200);

    let mut buffer = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    image_to_base64(&buffer.into_inner()).map_err(|e| e.to_string())
}
