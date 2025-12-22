use anyhow::{Context, Result};
use std::path::PathBuf;
use chrono::Utc;

/// Download image from URL and save to local file
/// Returns the local file path
pub async fn download_image(
    url: &str,
    output_dir: &str,
    organize_by_date: bool,
) -> Result<String> {
    // Download image
    let response = reqwest::get(url)
        .await
        .context("Failed to download image")?;

    if !response.status().is_success() {
        anyhow::bail!("Download failed with status: {}", response.status());
    }

    // Get content type before consuming response
    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = response.bytes()
        .await
        .context("Failed to read image bytes")?;

    // Determine file extension from content type or URL
    let extension = determine_extension(url, content_type.as_deref());

    // Generate filename
    let now = Utc::now();
    let hash = generate_short_hash(&bytes);
    let filename = format!("{}_{}.{}",
        now.format("%Y%m%d_%H%M%S"),
        hash,
        extension
    );

    // Build output path
    let mut output_path = PathBuf::from(output_dir);

    if organize_by_date {
        output_path = output_path.join(now.format("%Y-%m").to_string());
    }

    // Ensure directory exists
    std::fs::create_dir_all(&output_path)
        .context("Failed to create output directory")?;

    output_path = output_path.join(&filename);

    // Save file
    std::fs::write(&output_path, &bytes)
        .context("Failed to save image file")?;

    Ok(output_path.to_string_lossy().to_string())
}

/// Determine file extension from URL or content type
fn determine_extension(url: &str, content_type: Option<&str>) -> &'static str {
    // Try content-type header first
    if let Some(ct) = content_type {
        if ct.contains("png") {
            return "png";
        } else if ct.contains("gif") {
            return "gif";
        } else if ct.contains("webp") {
            return "webp";
        }
    }

    // Try URL extension
    let url_lower = url.to_lowercase();
    if url_lower.contains(".png") {
        return "png";
    } else if url_lower.contains(".gif") {
        return "gif";
    } else if url_lower.contains(".webp") {
        return "webp";
    }

    // Default to JPEG
    "jpg"
}

/// Generate a short hash for filename uniqueness
fn generate_short_hash(data: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{:x}", hash)[..8].to_string()
}
