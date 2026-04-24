use crate::image_processing::{image_to_base64, smart_resize};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageFileInfo {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub was_resized: bool,
    pub original_width: u32,
    pub original_height: u32,
}

/// Read and process an image file for use as reference
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<ImageFileInfo, String> {
    // Read file
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let file_size = data.len() as u64;

    // Smart resize if needed
    let result = smart_resize(&data).map_err(|e| e.to_string())?;

    // Convert to base64
    let base64 = image_to_base64(&result.data).map_err(|e| e.to_string())?;

    Ok(ImageFileInfo {
        base64,
        width: result.width,
        height: result.height,
        file_size,
        was_resized: result.was_resized,
        original_width: result.original_width,
        original_height: result.original_height,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFileInfo {
    pub base64: String,
    pub file_size: u64,
    pub mime_type: String,
}

/// Read a video or audio file and return as base64 data URL
#[tauri::command]
pub fn read_media_file(path: String) -> Result<MediaFileInfo, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let file_size = data.len() as u64;

    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = match ext.as_str() {
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        _ => return Err(format!("Unsupported media file type: .{}", ext)),
    };

    let encoded = STANDARD.encode(&data);
    let base64_url = format!("data:{};base64,{}", mime_type, encoded);

    Ok(MediaFileInfo {
        base64: base64_url,
        file_size,
        mime_type: mime_type.to_string(),
    })
}

/// Read raw image file and return base64 (for gallery images that don't need resize)
#[tauri::command]
pub async fn read_image_raw(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    image_to_base64(&data).map_err(|e| e.to_string())
}

/// Open a folder in the system file explorer
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Open folder and select/reveal a specific file
#[tauri::command]
pub async fn reveal_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try dbus for Nautilus/GNOME Files, fall back to opening parent folder
        let result = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:file://{}", path),
                "string:",
            ])
            .spawn();

        if result.is_err() {
            // Fall back to opening parent directory
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::process::Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

/// Open a file with the default application
#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    opener::open(&path).map_err(|e| e.to_string())
}

/// Check if a path exists
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Create directory if it doesn't exist
#[tauri::command]
pub async fn ensure_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

/// Get file metadata
#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileMetadata, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;

    Ok(FileMetadata {
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_dir: metadata.is_dir(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub size: u64,
    pub is_file: bool,
    pub is_dir: bool,
}
