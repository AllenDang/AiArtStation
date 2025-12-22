use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;

/// Convert image bytes to Base64 string with data URL prefix.
///
/// Returns: `"data:image/{format};base64,{encoded}"`
pub fn image_to_base64(data: &[u8]) -> Result<String> {
    let format =
        image::guess_format(data).context("Failed to detect image format")?;

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
        let encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 90);
        img.write_with_encoder(encoder).unwrap();
        let jpeg_data = buffer.into_inner();

        let base64 = image_to_base64(&jpeg_data).unwrap();
        assert!(base64.starts_with("data:image/jpeg;base64,"));
    }
}
