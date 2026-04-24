use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use std::io::Cursor;

/// Convert image bytes to Base64 string with data URL prefix.
///
/// Returns: `"data:image/{format};base64,{encoded}"`
pub fn image_to_base64(data: &[u8]) -> Result<String> {
    let format = image::guess_format(data).context("Failed to detect image format")?;

    let mime_type = match format {
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Png => "png",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        _ => "jpeg",
    };

    let encoded = STANDARD.encode(data);
    Ok(format!("data:image/{};base64,{}", mime_type, encoded))
}

/// Create a small thumbnail from image bytes and return as Base64 string.
///
/// Creates a 200x200 max thumbnail for fast loading in gallery views.
pub fn create_thumbnail_base64(data: &[u8], max_size: u32) -> Result<String> {
    let img = image::load_from_memory(data).context("Failed to decode image for thumbnail")?;

    // Create thumbnail
    let thumbnail = img.thumbnail(max_size, max_size);

    // Encode to JPEG (smaller than PNG for thumbnails)
    let mut buffer = Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 80);
    thumbnail
        .write_with_encoder(encoder)
        .context("Failed to encode thumbnail")?;

    let jpeg_data = buffer.into_inner();
    let encoded = STANDARD.encode(&jpeg_data);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::DynamicImage;
    use std::io::Cursor;

    #[test]
    fn test_image_to_base64() {
        // Create a simple test image and encode to JPEG
        let img = DynamicImage::new_rgb8(10, 10);
        let mut buffer = Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 90);
        img.write_with_encoder(encoder).unwrap();
        let jpeg_data = buffer.into_inner();

        let base64 = image_to_base64(&jpeg_data).unwrap();
        assert!(base64.starts_with("data:image/jpeg;base64,"));
    }
}
