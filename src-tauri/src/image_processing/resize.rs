use anyhow::{Context, Result};
use image::{DynamicImage, GenericImageView};
use std::io::Cursor;

const MAX_DIMENSION: u32 = 6000;
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024; // 10MB
const INITIAL_QUALITY: u8 = 90;
const MIN_QUALITY: u8 = 60;
const QUALITY_STEP: u8 = 5;

#[derive(Debug, Clone)]
pub struct ResizeResult {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub was_resized: bool,
    pub original_width: u32,
    pub original_height: u32,
}

/// Smart resize an image to fit within API constraints.
///
/// - Max dimensions: 6000x6000
/// - Max file size: 10MB
/// - Uses Lanczos3 filter for high quality downscaling
pub fn smart_resize(image_data: &[u8]) -> Result<ResizeResult> {
    let img = image::load_from_memory(image_data).context("Failed to decode image")?;

    let (original_width, original_height) = img.dimensions();
    let mut was_resized = false;

    // Check if resize is needed for dimensions
    let (new_width, new_height) =
        if original_width > MAX_DIMENSION || original_height > MAX_DIMENSION {
            was_resized = true;
            calculate_new_dimensions(original_width, original_height, MAX_DIMENSION)
        } else {
            (original_width, original_height)
        };

    // Resize if dimensions changed
    let resized_img = if was_resized {
        img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    // Encode to JPEG and check file size
    let (data, final_width, final_height) =
        encode_with_size_limit(&resized_img, new_width, new_height, MAX_FILE_SIZE)?;

    // Update was_resized if we had to reduce dimensions for file size
    if final_width != original_width || final_height != original_height {
        was_resized = true;
    }

    Ok(ResizeResult {
        data,
        width: final_width,
        height: final_height,
        was_resized,
        original_width,
        original_height,
    })
}

/// Calculate new dimensions while preserving aspect ratio
fn calculate_new_dimensions(width: u32, height: u32, max_dim: u32) -> (u32, u32) {
    let ratio = width as f64 / height as f64;

    if width >= height {
        let new_width = max_dim;
        let new_height = (max_dim as f64 / ratio).round() as u32;
        (new_width, new_height)
    } else {
        let new_height = max_dim;
        let new_width = (max_dim as f64 * ratio).round() as u32;
        (new_width, new_height)
    }
}

/// Encode image to JPEG, reducing quality/dimensions if needed to fit size limit
fn encode_with_size_limit(
    img: &DynamicImage,
    width: u32,
    height: u32,
    max_size: usize,
) -> Result<(Vec<u8>, u32, u32)> {
    let mut current_img = img.clone();
    let mut current_width = width;
    let mut current_height = height;
    let mut quality = INITIAL_QUALITY;

    loop {
        // Try encoding with current quality
        let mut buffer = Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality);
        current_img
            .write_with_encoder(encoder)
            .context("Failed to encode image")?;

        let data = buffer.into_inner();

        // Check if size is acceptable
        if data.len() <= max_size {
            return Ok((data, current_width, current_height));
        }

        // Try reducing quality first
        if quality > MIN_QUALITY {
            quality = quality.saturating_sub(QUALITY_STEP);
            continue;
        }

        // Quality at minimum, need to reduce dimensions
        quality = INITIAL_QUALITY; // Reset quality
        current_width = (current_width as f64 * 0.9).round() as u32;
        current_height = (current_height as f64 * 0.9).round() as u32;

        // Safety check - don't go too small
        if current_width < 100 || current_height < 100 {
            // Just return what we have
            return Ok((data, current_width, current_height));
        }

        current_img = img.resize(
            current_width,
            current_height,
            image::imageops::FilterType::Lanczos3,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_dimensions_landscape() {
        let (w, h) = calculate_new_dimensions(8000, 4000, 6000);
        assert_eq!(w, 6000);
        assert_eq!(h, 3000);
    }

    #[test]
    fn test_calculate_dimensions_portrait() {
        let (w, h) = calculate_new_dimensions(4000, 8000, 6000);
        assert_eq!(w, 3000);
        assert_eq!(h, 6000);
    }

    #[test]
    fn test_calculate_dimensions_square() {
        let (w, h) = calculate_new_dimensions(8000, 8000, 6000);
        assert_eq!(w, 6000);
        assert_eq!(h, 6000);
    }
}
