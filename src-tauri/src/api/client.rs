use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct ApiClient {
    client: Client,
    base_url: String,
    api_token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageGenerationRequest {
    pub model: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watermark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequential_image_generation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequential_image_generation_options: Option<SequentialOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimize_prompt_options: Option<OptimizePromptOptions>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ImageInput {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Serialize)]
pub struct SequentialOptions {
    pub max_images: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct OptimizePromptOptions {
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageGenerationResponse {
    pub data: Vec<GeneratedImage>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeneratedImage {
    pub url: Option<String>,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiError {
    pub error: ApiErrorDetail,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiErrorDetail {
    pub message: String,
}

// ============================================================================
// Video Generation Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct VideoGenerationRequest {
    pub model: String,
    pub content: Vec<VideoContentItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generate_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_last_frame: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watermark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoContentItem {
    #[serde(rename = "type")]
    pub content_type: String, // "text", "image_url", "video_url", "audio_url"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<VideoImageUrl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<VideoVideoUrl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_url: Option<VideoAudioUrl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>, // "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoImageUrl {
    pub url: String, // Base64 data URL or HTTP URL
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoVideoUrl {
    pub url: String, // Base64 data URL or HTTP URL
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoAudioUrl {
    pub url: String, // Base64 data URL or HTTP URL
}

#[derive(Debug, Clone, Deserialize)]
pub struct VideoTaskCreateResponse {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VideoTaskStatusResponse {
    pub status: String, // "queued", "running", "succeeded", "failed", "expired"
    #[serde(default)]
    pub content: Option<VideoTaskContent>,
    #[serde(default)]
    pub usage: Option<VideoUsage>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub framespersecond: Option<i32>,
    #[serde(default)]
    pub error: Option<VideoTaskError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VideoTaskContent {
    pub video_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VideoUsage {
    #[serde(default)]
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VideoTaskError {
    pub message: Option<String>,
}

impl ApiClient {
    pub fn new(base_url: &str, api_token: &str) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(600)) // 10 minute timeout for sequential image generation
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_token: api_token.to_string(),
        })
    }

    /// Generate images using the AI API
    pub async fn generate_images(&self, request: ImageGenerationRequest) -> Result<ImageGenerationResponse> {
        let url = format!("{}/images/generations", self.base_url);

        let response = match self.client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_token))
            .json(&request)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                if e.is_timeout() {
                    anyhow::bail!("Request timeout: The image generation took too long. Try reducing the number of images or simplifying your prompt.");
                } else if e.is_connect() {
                    anyhow::bail!("Connection failed: Cannot connect to API server. Please check your network and API URL settings.");
                } else if e.is_request() {
                    anyhow::bail!("Request error: {}", e);
                } else {
                    anyhow::bail!("Network error: {}", e);
                }
            }
        };

        let status = response.status();
        let body = response.text().await
            .context("Failed to read response body")?;

        if !status.is_success() {
            // Try to parse error response
            if let Ok(error) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!("API error ({}): {}", status.as_u16(), error.error.message);
            } else {
                // Truncate very long error bodies
                let error_preview = if body.len() > 500 {
                    format!("{}... (truncated)", &body[..500])
                } else {
                    body.clone()
                };
                anyhow::bail!("API request failed (HTTP {}): {}", status.as_u16(), error_preview);
            }
        }

        serde_json::from_str(&body)
            .with_context(|| format!("Failed to parse API response: {}", if body.len() > 200 { &body[..200] } else { &body }))
    }

    /// Create a video generation task
    pub async fn create_video_task(&self, request: VideoGenerationRequest) -> Result<VideoTaskCreateResponse> {
        let url = format!("{}/contents/generations/tasks", self.base_url);

        let response = self.client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_token))
            .json(&request)
            .send()
            .await
            .context("Failed to send video task request")?;

        let status = response.status();
        let body = response.text().await
            .context("Failed to read response body")?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!("API error: {}", error.error.message);
            } else {
                anyhow::bail!("API request failed with status {}: {}", status, body);
            }
        }

        serde_json::from_str(&body)
            .context("Failed to parse video task create response")
    }

    /// Get video task status
    pub async fn get_video_task(&self, task_id: &str) -> Result<VideoTaskStatusResponse> {
        let url = format!("{}/contents/generations/tasks/{}", self.base_url, task_id);

        let response = self.client
            .get(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_token))
            .send()
            .await
            .context("Failed to send video task status request")?;

        let status = response.status();
        let body = response.text().await
            .context("Failed to read response body")?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!("API error: {}", error.error.message);
            } else {
                anyhow::bail!("API request failed with status {}: {}", status, body);
            }
        }

        serde_json::from_str(&body)
            .context("Failed to parse video task status response")
    }

    /// Test connection by making a simple request
    /// Returns true if connection is successful
    pub async fn test_connection(&self) -> Result<bool> {
        // We don't have a dedicated health endpoint, so we'll just check if we can reach the server
        // A real implementation might use a specific test endpoint
        let url = format!("{}/images/generations", self.base_url);

        // Make a minimal request - it will fail with 400 but proves connectivity
        let response = self.client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_token))
            .json(&serde_json::json!({"test": true}))
            .send()
            .await;

        match response {
            Ok(resp) => {
                // 400/401/403 means we reached the server
                // 401 = bad token, 400 = bad request format, 403 = forbidden
                // Any of these means connection works
                let status = resp.status().as_u16();
                Ok(status != 0) // Any response means connection works
            }
            Err(e) => {
                if e.is_timeout() {
                    anyhow::bail!("Connection timeout");
                } else if e.is_connect() {
                    anyhow::bail!("Cannot connect to server");
                } else {
                    anyhow::bail!("Connection error: {}", e);
                }
            }
        }
    }
}

impl Default for ImageGenerationRequest {
    fn default() -> Self {
        Self {
            model: String::new(),
            prompt: String::new(),
            image: None,
            size: Some("2K".to_string()),
            watermark: Some(false),
            sequential_image_generation: Some("disabled".to_string()),
            sequential_image_generation_options: None,
            response_format: Some("url".to_string()),
            optimize_prompt_options: None,
        }
    }
}

impl ImageGenerationRequest {
    pub fn text_to_image(model: &str, prompt: &str) -> Self {
        Self {
            model: model.to_string(),
            prompt: prompt.to_string(),
            ..Default::default()
        }
    }

    pub fn image_to_image(model: &str, prompt: &str, reference_base64: &str) -> Self {
        Self {
            model: model.to_string(),
            prompt: prompt.to_string(),
            image: Some(ImageInput::Single(reference_base64.to_string())),
            ..Default::default()
        }
    }

    pub fn multi_image_fusion(model: &str, prompt: &str, references: Vec<String>) -> Self {
        Self {
            model: model.to_string(),
            prompt: prompt.to_string(),
            image: Some(ImageInput::Multiple(references)),
            ..Default::default()
        }
    }

    pub fn with_size(mut self, size: &str) -> Self {
        self.size = Some(size.to_string());
        self
    }

    pub fn with_watermark(mut self, watermark: bool) -> Self {
        self.watermark = Some(watermark);
        self
    }

    pub fn with_batch(mut self, max_images: i32) -> Self {
        self.sequential_image_generation = Some("auto".to_string());
        self.sequential_image_generation_options = Some(SequentialOptions { max_images });
        self
    }

    pub fn with_optimize_prompt(mut self, mode: &str) -> Self {
        self.optimize_prompt_options = Some(OptimizePromptOptions {
            mode: mode.to_string(),
        });
        self
    }
}
