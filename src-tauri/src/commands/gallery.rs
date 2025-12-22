use crate::commands::generation::DbState;
use crate::image_processing::image_to_base64;
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
        .map(|record| map_to_gallery_image(record, false))
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

fn map_to_gallery_image(record: ImageRecord, include_thumbnail: bool) -> GalleryImage {
    let thumbnail = if include_thumbnail {
        load_thumbnail(&record.file_path).ok()
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
    }
}

fn load_thumbnail(file_path: &str) -> Result<String, String> {
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
