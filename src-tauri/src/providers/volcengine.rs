use super::{
    CredentialField, Credentials, EnumOption, Features, GenerationManifest, ImageMetadata,
    ParamField, Provider, ProviderCapabilities, ProviderImage, ProviderImageOutput,
    ProviderImageSource, ProviderVideoStatus, ProviderVideoTask, ReferenceMedia, RequestOptions,
    VideoMetadata, VisibleWhen,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CRED_BASE_URL: &str = "base_url";
const CRED_API_TOKEN: &str = "api_token";

pub struct VolcengineProvider;

#[async_trait]
impl Provider for VolcengineProvider {
    fn provider_type(&self) -> &'static str {
        "volcengine_ark"
    }

    fn display_name(&self) -> &'static str {
        "火山引擎 Ark"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            image: true,
            video: true,
        }
    }

    fn credential_schema(&self) -> Vec<CredentialField> {
        vec![
            CredentialField {
                key: CRED_BASE_URL.to_string(),
                label: "基础 URL".to_string(),
                placeholder: Some("https://ark.cn-beijing.volces.com/api/v3".to_string()),
                secret: false,
                required: true,
            },
            CredentialField {
                key: CRED_API_TOKEN.to_string(),
                label: "API 令牌".to_string(),
                placeholder: Some("sk-...".to_string()),
                secret: true,
                required: true,
            },
        ]
    }

    fn image_manifest(&self) -> Option<GenerationManifest> {
        Some(image_manifest())
    }

    fn video_manifest(&self) -> Option<GenerationManifest> {
        Some(video_manifest())
    }

    async fn generate_image(
        &self,
        credentials: &Credentials,
        model: &str,
        prompt: &str,
        params: &Value,
        reference: &ReferenceMedia,
        options: RequestOptions,
    ) -> Result<ProviderImageOutput> {
        let (base_url, api_token) = extract_credentials(credentials)?;

        // Map aspect ratio to size string. Users pick aspect_ratio in UI, but the Ark
        // API expects a pixel-dimension size string.
        let aspect_ratio = params
            .get("aspect_ratio")
            .and_then(|v| v.as_str())
            .unwrap_or("1:1");
        let base_size = params.get("size").and_then(|v| v.as_str()).unwrap_or("2K");
        let size = resolve_image_size(base_size, aspect_ratio);

        let image_input = if !reference.reference_images.is_empty() {
            if reference.reference_images.len() == 1 {
                Some(ImageInput::Single(reference.reference_images[0].clone()))
            } else {
                Some(ImageInput::Multiple(reference.reference_images.clone()))
            }
        } else {
            None
        };

        let sequential = params
            .get("sequential_generation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let max_images = params
            .get("max_images")
            .and_then(|v| v.as_i64())
            .map(|n| n as i32);

        let optimize_prompt = params
            .get("optimize_prompt")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let optimize_mode = params
            .get("optimize_prompt_mode")
            .and_then(|v| v.as_str())
            .unwrap_or("standard");

        let watermark = params
            .get("watermark")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut api_request = json!({
            "model": model,
            "prompt": prompt,
            "size": size,
            "watermark": watermark,
            "response_format": "url",
            "sequential_image_generation": if sequential { "auto" } else { "disabled" },
        });

        if let Some(image) = image_input {
            api_request["image"] = serde_json::to_value(image)?;
        }
        if sequential {
            api_request["sequential_image_generation_options"] = json!({
                "max_images": max_images.unwrap_or(3),
            });
        }
        if optimize_prompt {
            api_request["optimize_prompt_options"] = json!({
                "mode": optimize_mode,
            });
        }

        let client = build_http_client(options)?;
        let url = format!("{}/images/generations", base_url.trim_end_matches('/'));

        let response = send_post(&client, &url, &api_token, &api_request).await?;
        let parsed: ImageGenerationResponse = serde_json::from_str(&response)
            .with_context(|| format!("Failed to parse image response: {}", preview(&response)))?;

        // Classify based on how many reference images the user supplied.
        let generation_type = if reference.reference_images.is_empty() {
            "text-to-image"
        } else if reference.reference_images.len() == 1 {
            "image-to-image"
        } else {
            "multi-fusion"
        }
        .to_string();

        Ok(ProviderImageOutput {
            tokens_used: parsed.usage.total_tokens,
            images: parsed
                .data
                .into_iter()
                .filter_map(|img| {
                    img.url.map(|url| ProviderImage {
                        source: ProviderImageSource::Url(url),
                        size: img.size,
                    })
                })
                .collect(),
            metadata: ImageMetadata {
                generation_type,
                aspect_ratio: aspect_ratio.to_string(),
                size,
            },
        })
    }

    async fn create_video_task(
        &self,
        credentials: &Credentials,
        model: &str,
        prompt: &str,
        params: &Value,
        reference: &ReferenceMedia,
        options: RequestOptions,
    ) -> Result<ProviderVideoTask> {
        let (base_url, api_token) = extract_credentials(credentials)?;

        let generation_type = params
            .get("generation_type")
            .and_then(|v| v.as_str())
            .unwrap_or("text-to-video");

        let mut content: Vec<Value> = vec![json!({
            "type": "text",
            "text": prompt,
        })];

        match generation_type {
            "image-to-video-first" => {
                if let Some(first) = &reference.first_frame {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": { "url": first },
                    }));
                }
            }
            "image-to-video-both" => {
                if let Some(first) = &reference.first_frame {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": { "url": first },
                        "role": "first_frame",
                    }));
                }
                if let Some(last) = &reference.last_frame {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": { "url": last },
                        "role": "last_frame",
                    }));
                }
            }
            "image-to-video-ref" | "multimodal-ref" => {
                for img in &reference.reference_images {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": { "url": img },
                        "role": "reference_image",
                    }));
                }
                for vid in &reference.reference_videos {
                    content.push(json!({
                        "type": "video_url",
                        "video_url": { "url": vid },
                        "role": "reference_video",
                    }));
                }
                for aud in &reference.reference_audios {
                    content.push(json!({
                        "type": "audio_url",
                        "audio_url": { "url": aud },
                        "role": "reference_audio",
                    }));
                }
            }
            _ => {} // text-to-video
        }

        let mut body = json!({
            "model": model,
            "content": content,
        });

        if let Some(v) = params.get("resolution").and_then(|v| v.as_str()) {
            body["resolution"] = json!(v);
        }
        if let Some(v) = params.get("aspect_ratio").and_then(|v| v.as_str()) {
            body["ratio"] = json!(v);
        }
        if let Some(v) = params.get("duration").and_then(|v| v.as_i64()) {
            body["duration"] = json!(v);
        }
        if let Some(v) = params.get("generate_audio").and_then(|v| v.as_bool()) {
            body["generate_audio"] = json!(v);
        }
        if let Some(v) = params.get("return_last_frame").and_then(|v| v.as_bool()) {
            body["return_last_frame"] = json!(v);
        }
        if let Some(v) = params.get("watermark").and_then(|v| v.as_bool()) {
            body["watermark"] = json!(v);
        }
        if let Some(v) = params.get("seed").and_then(|v| v.as_i64()) {
            body["seed"] = json!(v);
        }

        let client = build_http_client(options)?;
        let url = format!(
            "{}/contents/generations/tasks",
            base_url.trim_end_matches('/')
        );

        let response = send_post(&client, &url, &api_token, &body).await?;
        let parsed: VideoTaskCreateResponse =
            serde_json::from_str(&response).with_context(|| {
                format!("Failed to parse video task create: {}", preview(&response))
            })?;

        let metadata = VideoMetadata {
            generation_type: generation_type.to_string(),
            aspect_ratio: params
                .get("aspect_ratio")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            resolution: params
                .get("resolution")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            duration: params
                .get("duration")
                .and_then(|v| v.as_i64())
                .map(|d| d as f64),
        };

        Ok(ProviderVideoTask {
            task_id: parsed.id,
            metadata,
        })
    }

    async fn poll_video_task(
        &self,
        credentials: &Credentials,
        task_id: &str,
        options: RequestOptions,
    ) -> Result<ProviderVideoStatus> {
        let (base_url, api_token) = extract_credentials(credentials)?;

        let client = build_http_client(options)?;
        let url = format!(
            "{}/contents/generations/tasks/{}",
            base_url.trim_end_matches('/'),
            task_id
        );

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_token))
            .send()
            .await
            .context("Failed to send video status request")?;

        let status = resp.status();
        let body = resp.text().await.context("Failed to read response body")?;

        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!("API error: {}", err.error.message);
            }
            anyhow::bail!("API request failed ({}): {}", status, preview(&body));
        }

        let parsed: VideoTaskStatusResponse = serde_json::from_str(&body)
            .with_context(|| format!("Failed to parse video status: {}", preview(&body)))?;

        let normalized = match parsed.status.as_str() {
            "queued" => "pending",
            "running" => "processing",
            "succeeded" => "completed",
            "failed" | "expired" => "failed",
            other => other,
        }
        .to_string();

        Ok(ProviderVideoStatus {
            status: normalized,
            video_url: parsed.content.and_then(|c| c.video_url),
            resolution: parsed.resolution,
            duration: parsed.duration,
            fps: parsed.framespersecond,
            tokens_used: parsed.usage.map(|u| u.total_tokens),
            error_message: parsed.error.and_then(|e| e.message),
        })
    }

    async fn test_connection(
        &self,
        credentials: &Credentials,
        options: RequestOptions,
    ) -> Result<()> {
        let (base_url, api_token) = extract_credentials(credentials)?;

        let client = build_http_client(options)?;
        let url = format!("{}/images/generations", base_url.trim_end_matches('/'));

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_token))
            .json(&json!({"test": true}))
            .send()
            .await;

        match resp {
            // Any HTTP response (even 400/401) means the server is reachable.
            Ok(_) => Ok(()),
            Err(e) if e.is_timeout() => Err(anyhow!("连接超时")),
            Err(e) if e.is_connect() => Err(anyhow!("无法连接到服务器")),
            Err(e) => Err(anyhow!("连接错误: {}", e)),
        }
    }
}

// ============================================================================
// Manifests
// ============================================================================

fn image_manifest() -> GenerationManifest {
    GenerationManifest {
        params: vec![
            ParamField::Enum {
                key: "aspect_ratio".to_string(),
                label: "宽高比".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("1:1"),
                        label: "1:1 方形".to_string(),
                        description: Some("2048×2048".to_string()),
                    },
                    EnumOption {
                        value: json!("4:3"),
                        label: "4:3".to_string(),
                        description: Some("2304×1728".to_string()),
                    },
                    EnumOption {
                        value: json!("3:4"),
                        label: "3:4".to_string(),
                        description: Some("1728×2304".to_string()),
                    },
                    EnumOption {
                        value: json!("16:9"),
                        label: "16:9 横屏".to_string(),
                        description: Some("2560×1440".to_string()),
                    },
                    EnumOption {
                        value: json!("9:16"),
                        label: "9:16 竖屏".to_string(),
                        description: Some("1440×2560".to_string()),
                    },
                    EnumOption {
                        value: json!("3:2"),
                        label: "3:2".to_string(),
                        description: Some("2496×1664".to_string()),
                    },
                    EnumOption {
                        value: json!("2:3"),
                        label: "2:3".to_string(),
                        description: Some("1664×2496".to_string()),
                    },
                    EnumOption {
                        value: json!("21:9"),
                        label: "21:9 超宽".to_string(),
                        description: Some("3024×1296".to_string()),
                    },
                ],
                default: json!("1:1"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "size".to_string(),
                label: "分辨率".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("2K"),
                        label: "2K".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("4K"),
                        label: "4K".to_string(),
                        description: None,
                    },
                ],
                default: json!("2K"),
                visible_when: None,
            },
            ParamField::Boolean {
                key: "sequential_generation".to_string(),
                label: "生成组图".to_string(),
                default: false,
                visible_when: None,
            },
            ParamField::Number {
                key: "max_images".to_string(),
                label: "组图数量".to_string(),
                min: 2.0,
                max: 15.0,
                step: 1.0,
                default: json!(3),
                visible_when: Some(VisibleWhen {
                    field: "sequential_generation".to_string(),
                    equals: Some(json!(true)),
                    in_values: None,
                }),
            },
            ParamField::Boolean {
                key: "optimize_prompt".to_string(),
                label: "优化提示词".to_string(),
                default: false,
                visible_when: None,
            },
            ParamField::Enum {
                key: "optimize_prompt_mode".to_string(),
                label: "优化模式".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("standard"),
                        label: "标准".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("fast"),
                        label: "快速".to_string(),
                        description: None,
                    },
                ],
                default: json!("standard"),
                visible_when: Some(VisibleWhen {
                    field: "optimize_prompt".to_string(),
                    equals: Some(json!(true)),
                    in_values: None,
                }),
            },
            ParamField::Boolean {
                key: "watermark".to_string(),
                label: "水印".to_string(),
                default: false,
                visible_when: None,
            },
        ],
        features: Features {
            reference_images: Some(14),
            mask: true,
            ..Default::default()
        },
        generation_type_key: None,
    }
}

fn video_manifest() -> GenerationManifest {
    GenerationManifest {
        params: vec![
            ParamField::Enum {
                key: "generation_type".to_string(),
                label: "生成类型".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("text-to-video"),
                        label: "文生视频".to_string(),
                        description: Some("纯文字描述生成视频".to_string()),
                    },
                    EnumOption {
                        value: json!("image-to-video-first"),
                        label: "首帧生成".to_string(),
                        description: Some("基于首帧图片生成视频".to_string()),
                    },
                    EnumOption {
                        value: json!("image-to-video-both"),
                        label: "首尾帧生成".to_string(),
                        description: Some("基于首尾帧生成过渡视频".to_string()),
                    },
                    EnumOption {
                        value: json!("image-to-video-ref"),
                        label: "参考图生成".to_string(),
                        description: Some("基于参考图片风格生成".to_string()),
                    },
                    EnumOption {
                        value: json!("multimodal-ref"),
                        label: "多模态参考".to_string(),
                        description: Some("参考图片+视频+音频生成".to_string()),
                    },
                ],
                default: json!("text-to-video"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "aspect_ratio".to_string(),
                label: "宽高比".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("16:9"),
                        label: "16:9 横屏".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("9:16"),
                        label: "9:16 竖屏".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("1:1"),
                        label: "1:1 方形".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("4:3"),
                        label: "4:3".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("3:4"),
                        label: "3:4".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("21:9"),
                        label: "21:9 超宽".to_string(),
                        description: None,
                    },
                ],
                default: json!("16:9"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "resolution".to_string(),
                label: "分辨率".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("480p"),
                        label: "480p".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("720p"),
                        label: "720p".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("1080p"),
                        label: "1080p".to_string(),
                        description: None,
                    },
                ],
                default: json!("720p"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "duration".to_string(),
                label: "时长".to_string(),
                options: duration_options(),
                default: json!(5),
                visible_when: None,
            },
            ParamField::Boolean {
                key: "generate_audio".to_string(),
                label: "生成音频".to_string(),
                default: true,
                visible_when: None,
            },
            ParamField::Boolean {
                key: "return_last_frame".to_string(),
                label: "返回尾帧".to_string(),
                default: false,
                visible_when: None,
            },
            ParamField::String {
                key: "seed".to_string(),
                label: "种子".to_string(),
                placeholder: Some("-1".to_string()),
                default: Some(json!("-1")),
                visible_when: None,
            },
            ParamField::Boolean {
                key: "watermark".to_string(),
                label: "水印".to_string(),
                default: false,
                visible_when: None,
            },
        ],
        features: Features {
            reference_images: Some(9),
            first_frame: true,
            last_frame: true,
            reference_videos: Some(3),
            reference_audios: Some(3),
            mask: false,
        },
        generation_type_key: Some("generation_type".to_string()),
    }
}

fn duration_options() -> Vec<EnumOption> {
    let mut opts = vec![EnumOption {
        value: json!(-1),
        label: "自动".to_string(),
        description: None,
    }];
    for i in 4..=15 {
        opts.push(EnumOption {
            value: json!(i),
            label: format!("{}秒", i),
            description: None,
        });
    }
    opts
}

// ============================================================================
// Helpers
// ============================================================================

fn extract_credentials(credentials: &Credentials) -> Result<(String, String)> {
    let base_url = credentials
        .get(CRED_BASE_URL)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow!("缺少基础 URL"))?
        .clone();
    let api_token = credentials
        .get(CRED_API_TOKEN)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow!("缺少 API 令牌"))?
        .clone();
    Ok((base_url, api_token))
}

fn build_http_client(options: RequestOptions) -> Result<Client> {
    let mut builder = Client::builder().timeout(std::time::Duration::from_secs(600));
    if options.no_proxy {
        builder = builder.no_proxy();
    }
    builder.build().context("Failed to create HTTP client")
}

async fn send_post(client: &Client, url: &str, api_token: &str, body: &Value) -> Result<String> {
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_token))
        .json(body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                anyhow!("请求超时：生成耗时过长")
            } else if e.is_connect() {
                anyhow!("连接失败：无法访问 API 服务器")
            } else {
                anyhow!("网络错误: {}", e)
            }
        })?;

    let status = resp.status();
    let body = resp.text().await.context("Failed to read response body")?;

    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<ApiError>(&body) {
            anyhow::bail!("API 错误 ({}): {}", status.as_u16(), err.error.message);
        }
        anyhow::bail!(
            "API 请求失败 (HTTP {}): {}",
            status.as_u16(),
            preview(&body)
        );
    }

    Ok(body)
}

fn preview(s: &str) -> String {
    if s.len() > 500 {
        format!("{}... (truncated)", &s[..500])
    } else {
        s.to_string()
    }
}

/// Map (base_size, aspect_ratio) → Ark size string.
/// The Ark image API accepts a "WIDTHxHEIGHT" pixel string.
fn resolve_image_size(base: &str, ratio: &str) -> String {
    match (base, ratio) {
        ("2K", "1:1") => "2048x2048",
        ("2K", "4:3") => "2304x1728",
        ("2K", "3:4") => "1728x2304",
        ("2K", "16:9") => "2560x1440",
        ("2K", "9:16") => "1440x2560",
        ("2K", "3:2") => "2496x1664",
        ("2K", "2:3") => "1664x2496",
        ("2K", "21:9") => "3024x1296",
        ("4K", "1:1") => "4096x4096",
        ("4K", "4:3") => "4608x3456",
        ("4K", "3:4") => "3456x4608",
        ("4K", "16:9") => "5120x2880",
        ("4K", "9:16") => "2880x5120",
        ("4K", "3:2") => "4992x3328",
        ("4K", "2:3") => "3328x4992",
        ("4K", "21:9") => "6048x2592",
        _ => "2048x2048",
    }
    .to_string()
}

// ============================================================================
// Ark API serde types (internal to this provider)
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum ImageInput {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
struct ImageGenerationResponse {
    data: Vec<GeneratedImage>,
    usage: Usage,
}

#[derive(Debug, Clone, Deserialize)]
struct GeneratedImage {
    url: Option<String>,
    size: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Usage {
    total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiError {
    error: ApiErrorDetail,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorDetail {
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
struct VideoTaskCreateResponse {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct VideoTaskStatusResponse {
    status: String,
    #[serde(default)]
    content: Option<VideoTaskContent>,
    #[serde(default)]
    usage: Option<VideoUsage>,
    #[serde(default)]
    resolution: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    framespersecond: Option<i32>,
    #[serde(default)]
    error: Option<VideoTaskError>,
}

#[derive(Debug, Clone, Deserialize)]
struct VideoTaskContent {
    video_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct VideoUsage {
    #[serde(default)]
    total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct VideoTaskError {
    message: Option<String>,
}
