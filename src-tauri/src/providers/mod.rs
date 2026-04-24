use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub mod openai;
pub mod volcengine;

// ============================================================================
// Provider Capability Types
// ============================================================================

/// What kinds of generation a provider supports.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub image: bool,
    pub video: bool,
}

/// A single credential input field (e.g. base_url, api_token).
#[derive(Debug, Clone, Serialize)]
pub struct CredentialField {
    pub key: String,
    pub label: String,
    pub placeholder: Option<String>,
    pub secret: bool,
    pub required: bool,
}

/// Provider descriptor surfaced to the frontend. Contains everything the UI
/// needs for both the settings (add/edit provider) and generation (model +
/// params) flows. Manifests are static per provider type — bundling them here
/// lets the frontend fetch one list instead of per-instance RPCs.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderDescriptor {
    pub provider_type: String,
    pub display_name: String,
    pub capabilities: ProviderCapabilities,
    pub credential_schema: Vec<CredentialField>,
    pub image_manifest: Option<GenerationManifest>,
    pub video_manifest: Option<GenerationManifest>,
}

/// Condition for conditionally rendering a field.
#[derive(Debug, Clone, Serialize)]
pub struct VisibleWhen {
    pub field: String,
    pub equals: Option<Value>,
    pub in_values: Option<Vec<Value>>,
}

/// A dropdown option (value + Chinese label).
#[derive(Debug, Clone, Serialize)]
pub struct EnumOption {
    pub value: Value,
    pub label: String,
    pub description: Option<String>,
}

/// A parameter field description. Rendered by the frontend DynamicForm.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ParamField {
    Enum {
        key: String,
        label: String,
        options: Vec<EnumOption>,
        default: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        visible_when: Option<VisibleWhen>,
    },
    Number {
        key: String,
        label: String,
        min: f64,
        max: f64,
        step: f64,
        default: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        visible_when: Option<VisibleWhen>,
    },
    Boolean {
        key: String,
        label: String,
        default: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        visible_when: Option<VisibleWhen>,
    },
    /// Short string (seed, custom size string, etc.).
    String {
        key: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        visible_when: Option<VisibleWhen>,
    },
}

/// Describes which reference-media inputs a manifest accepts.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Features {
    /// 参考图片（数量上限）
    pub reference_images: Option<usize>,
    /// 首帧
    pub first_frame: bool,
    /// 尾帧
    pub last_frame: bool,
    /// 参考视频（数量上限）
    pub reference_videos: Option<usize>,
    /// 参考音频（数量上限）
    pub reference_audios: Option<usize>,
    /// 支持蒙版/涂抹 (image mask)
    pub mask: bool,
}

/// Full UI description for a generation mode (image or video) of a provider.
/// The model name is a free-form string the user enters when configuring the
/// provider — it is not enumerated here.
#[derive(Debug, Clone, Serialize)]
pub struct GenerationManifest {
    /// Parameter fields driving the DynamicForm.
    pub params: Vec<ParamField>,
    /// Which reference/media inputs are available.
    pub features: Features,
    /// Which generation-type field (if any) controls conditional behavior.
    /// Frontend uses this as a known key for wiring up drop zones.
    pub generation_type_key: Option<String>,
}

// ============================================================================
// Runtime types
// ============================================================================

/// Decrypted credentials (key→value strings, e.g. base_url, api_token).
pub type Credentials = HashMap<String, String>;

/// Per-request knobs that are not part of the params schema but affect how
/// the HTTP client is built. Kept separate so provider implementations don't
/// have to reach into the app-level settings.
#[derive(Debug, Clone, Copy, Default)]
pub struct RequestOptions {
    /// Bypass any system HTTP proxy. Useful for in-country relays reached via
    /// a VPN that has its own idle timeout.
    pub no_proxy: bool,
}

/// Generation-type summary the provider computes from its own params. The
/// command layer stores this opaquely — it does not parse params itself.
#[derive(Debug, Clone, Default)]
pub struct ImageMetadata {
    /// Short label stored on the image row (e.g. "text-to-image", "image-to-image").
    /// Providers that don't have this concept can leave it blank.
    pub generation_type: String,
    /// Aspect ratio string the UI can show/filter on.
    pub aspect_ratio: String,
    /// Size string (e.g. "2048x2048") if available at request time.
    pub size: String,
}

/// Result of an image generation request.
#[derive(Debug, Clone)]
pub struct ProviderImageOutput {
    pub images: Vec<ProviderImage>,
    pub tokens_used: i64,
    pub metadata: ImageMetadata,
}

/// How the provider delivers the image bytes back to us.
#[derive(Debug, Clone)]
pub enum ProviderImageSource {
    /// Download from a remote URL.
    Url(String),
    /// Raw image bytes (e.g. base64-decoded JSON field).
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone)]
pub struct ProviderImage {
    pub source: ProviderImageSource,
    /// Size reported by provider (e.g. "2048x2048"), if available.
    pub size: Option<String>,
}

/// Result of creating a video task. Metadata fields are what the provider
/// decided the task will produce, so the command layer can store them without
/// knowing what goes into params.
#[derive(Debug, Clone)]
pub struct ProviderVideoTask {
    pub task_id: String,
    pub metadata: VideoMetadata,
}

#[derive(Debug, Clone, Default)]
pub struct VideoMetadata {
    pub generation_type: String,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<f64>,
}

/// Result of polling a video task.
#[derive(Debug, Clone)]
pub struct ProviderVideoStatus {
    /// Normalized: "pending" | "processing" | "completed" | "failed"
    pub status: String,
    /// URL to download the finished video, if completed.
    pub video_url: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<f64>,
    pub fps: Option<i32>,
    pub tokens_used: Option<i64>,
    pub error_message: Option<String>,
}

/// Reference inputs shared across generation requests.
#[derive(Debug, Clone, Default)]
pub struct ReferenceMedia {
    pub reference_images: Vec<String>, // base64 or data URL
    pub first_frame: Option<String>,
    pub last_frame: Option<String>,
    pub reference_videos: Vec<String>,
    pub reference_audios: Vec<String>,
}

// ============================================================================
// Provider trait
// ============================================================================

#[async_trait]
pub trait Provider: Send + Sync {
    fn provider_type(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> ProviderCapabilities;
    fn credential_schema(&self) -> Vec<CredentialField>;
    fn image_manifest(&self) -> Option<GenerationManifest>;
    fn video_manifest(&self) -> Option<GenerationManifest>;

    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            provider_type: self.provider_type().to_string(),
            display_name: self.display_name().to_string(),
            capabilities: self.capabilities(),
            credential_schema: self.credential_schema(),
            image_manifest: self.image_manifest(),
            video_manifest: self.video_manifest(),
        }
    }

    /// Prompt is required; model + params are passed as arbitrary JSON.
    async fn generate_image(
        &self,
        credentials: &Credentials,
        model: &str,
        prompt: &str,
        params: &Value,
        reference: &ReferenceMedia,
        options: RequestOptions,
    ) -> Result<ProviderImageOutput>;

    async fn create_video_task(
        &self,
        credentials: &Credentials,
        model: &str,
        prompt: &str,
        params: &Value,
        reference: &ReferenceMedia,
        options: RequestOptions,
    ) -> Result<ProviderVideoTask>;

    async fn poll_video_task(
        &self,
        credentials: &Credentials,
        task_id: &str,
        options: RequestOptions,
    ) -> Result<ProviderVideoStatus>;

    async fn test_connection(
        &self,
        credentials: &Credentials,
        options: RequestOptions,
    ) -> Result<()>;
}

// ============================================================================
// Registry
// ============================================================================

pub struct ProviderRegistry {
    providers: Vec<Arc<dyn Provider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: vec![
                Arc::new(volcengine::VolcengineProvider),
                Arc::new(openai::OpenAIProvider),
            ],
        }
    }

    pub fn get(&self, provider_type: &str) -> Option<Arc<dyn Provider>> {
        self.providers
            .iter()
            .find(|p| p.provider_type() == provider_type)
            .cloned()
    }

    pub fn descriptors(&self) -> Vec<ProviderDescriptor> {
        self.providers.iter().map(|p| p.descriptor()).collect()
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}
