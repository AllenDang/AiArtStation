//! OpenAI images provider (gpt-image-1 + legacy DALL·E compatibility).
//!
//! Endpoints:
//!   - POST /v1/images/generations  — text-to-image (no reference images)
//!   - POST /v1/images/edits        — image editing (multipart, with reference)
//!
//! The provider routes automatically based on whether reference images are
//! present: empty → generate, non-empty → edit.

use super::{
    CredentialField, Credentials, EnumOption, Features, GenerationManifest, ImageMetadata,
    ParamField, Provider, ProviderCapabilities, ProviderImage, ProviderImageOutput,
    ProviderImageSource, ProviderVideoStatus, ProviderVideoTask, ReferenceMedia, RequestOptions,
};
use anyhow::{Context, Result, anyhow, bail};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use reqwest::{
    Client,
    multipart::{Form, Part},
};
use serde::Deserialize;
use serde_json::{Value, json};

const CRED_BASE_URL: &str = "base_url";
const CRED_API_KEY: &str = "api_key";
const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

pub struct OpenAIProvider;

#[async_trait]
impl Provider for OpenAIProvider {
    fn provider_type(&self) -> &'static str {
        "openai_images"
    }

    fn display_name(&self) -> &'static str {
        "OpenAI 图像"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            image: true,
            video: false,
        }
    }

    fn credential_schema(&self) -> Vec<CredentialField> {
        vec![
            CredentialField {
                key: CRED_BASE_URL.to_string(),
                label: "API 基础 URL".to_string(),
                placeholder: Some(DEFAULT_BASE_URL.to_string()),
                secret: false,
                required: false,
            },
            CredentialField {
                key: CRED_API_KEY.to_string(),
                label: "API Key".to_string(),
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
        None
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
        let (base_url, api_key) = extract_credentials(credentials)?;

        let mut output = if reference.reference_images.is_empty() {
            generate(&base_url, &api_key, model, prompt, params, options).await?
        } else {
            edit(
                &base_url,
                &api_key,
                model,
                prompt,
                params,
                &reference.reference_images,
                options,
            )
            .await?
        };
        output.metadata.generation_type = if reference.reference_images.is_empty() {
            "text-to-image".to_string()
        } else if reference.reference_images.len() == 1 {
            "image-to-image".to_string()
        } else {
            "multi-fusion".to_string()
        };
        Ok(output)
    }

    async fn create_video_task(
        &self,
        _credentials: &Credentials,
        _model: &str,
        _prompt: &str,
        _params: &Value,
        _reference: &ReferenceMedia,
        _options: RequestOptions,
    ) -> Result<ProviderVideoTask> {
        bail!("OpenAI provider 不支持视频生成")
    }

    async fn poll_video_task(
        &self,
        _credentials: &Credentials,
        _task_id: &str,
        _options: RequestOptions,
    ) -> Result<ProviderVideoStatus> {
        bail!("OpenAI provider 不支持视频生成")
    }

    async fn test_connection(
        &self,
        credentials: &Credentials,
        options: RequestOptions,
    ) -> Result<()> {
        let (base_url, api_key) = extract_credentials(credentials)?;
        let client = build_http_client(options)?;
        // Hit /models which is cheap and auth-gated.
        let url = format!("{}/models", base_url.trim_end_matches('/'));
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => Ok(()),
            Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
                Err(anyhow!("API Key 无效（401）"))
            }
            Ok(r) => Err(anyhow!("服务器返回 {}", r.status())),
            Err(e) if e.is_timeout() => Err(anyhow!("连接超时")),
            Err(e) if e.is_connect() => Err(anyhow!("无法连接到服务器")),
            Err(e) => Err(anyhow!("连接错误: {}", e)),
        }
    }
}

// ============================================================================
// Manifest
// ============================================================================

fn image_manifest() -> GenerationManifest {
    GenerationManifest {
        params: vec![
            ParamField::Enum {
                key: "size".to_string(),
                label: "尺寸".to_string(),
                // gpt-image-1 supports 1024x1024, 1024x1536, 1536x1024, and "auto".
                options: vec![
                    EnumOption {
                        value: json!("auto"),
                        label: "自动".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("1024x1024"),
                        label: "1024×1024 方形".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("1536x1024"),
                        label: "1536×1024 横屏".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("1024x1536"),
                        label: "1024×1536 竖屏".to_string(),
                        description: None,
                    },
                ],
                default: json!("auto"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "quality".to_string(),
                label: "质量".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("auto"),
                        label: "自动".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("low"),
                        label: "低".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("medium"),
                        label: "中".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("high"),
                        label: "高".to_string(),
                        description: None,
                    },
                ],
                default: json!("auto"),
                visible_when: None,
            },
            ParamField::Enum {
                key: "background".to_string(),
                label: "背景".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("auto"),
                        label: "自动".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("transparent"),
                        label: "透明".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("opaque"),
                        label: "不透明".to_string(),
                        description: None,
                    },
                ],
                default: json!("auto"),
                visible_when: None,
            },
            ParamField::Number {
                key: "n".to_string(),
                label: "数量".to_string(),
                min: 1.0,
                max: 10.0,
                step: 1.0,
                default: json!(1),
                visible_when: None,
            },
            ParamField::Enum {
                key: "output_format".to_string(),
                label: "输出格式".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("png"),
                        label: "PNG".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("jpeg"),
                        label: "JPEG".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("webp"),
                        label: "WebP".to_string(),
                        description: None,
                    },
                ],
                default: json!("png"),
                visible_when: None,
            },
            // Only applies to edits — the /generations endpoint ignores it.
            ParamField::Enum {
                key: "input_fidelity".to_string(),
                label: "输入保真度".to_string(),
                options: vec![
                    EnumOption {
                        value: json!("low"),
                        label: "低".to_string(),
                        description: None,
                    },
                    EnumOption {
                        value: json!("high"),
                        label: "高（编辑时保留参考图细节）".to_string(),
                        description: None,
                    },
                ],
                default: json!("low"),
                visible_when: None,
            },
        ],
        features: Features {
            // gpt-image-1 edits accept up to 16 reference images.
            reference_images: Some(16),
            mask: false,
            ..Default::default()
        },
        generation_type_key: None,
    }
}

// ============================================================================
// Generation (/v1/images/generations — JSON body)
// ============================================================================

async fn generate(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    params: &Value,
    options: RequestOptions,
) -> Result<ProviderImageOutput> {
    // gpt-image-* always returns base64 and rejects response_format. Older
    // DALL·E models return URLs by default but the command layer accepts both,
    // so we simply omit response_format everywhere.
    let mut body = json!({
        "model": model,
        "prompt": prompt,
    });

    copy_string_param(&mut body, params, "size");
    copy_string_param(&mut body, params, "quality");
    copy_string_param(&mut body, params, "background");
    copy_string_param(&mut body, params, "output_format");
    if let Some(n) = params.get("n").and_then(|v| v.as_i64()) {
        body["n"] = json!(n);
    }

    let client = build_http_client(options)?;
    let url = format!("{}/images/generations", base_url.trim_end_matches('/'));
    let response_body = send_json(&client, &url, api_key, &body).await?;
    parse_images_response(&response_body, params)
}

// ============================================================================
// Edit (/v1/images/edits — multipart body with reference images)
// ============================================================================

async fn edit(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    params: &Value,
    reference_images: &[String],
    options: RequestOptions,
) -> Result<ProviderImageOutput> {
    let client = build_http_client(options)?;
    let url = format!("{}/images/edits", base_url.trim_end_matches('/'));

    let mut form = Form::new()
        .text("model", model.to_string())
        .text("prompt", prompt.to_string());

    if let Some(v) = params.get("size").and_then(|v| v.as_str()) {
        form = form.text("size", v.to_string());
    }
    if let Some(v) = params.get("quality").and_then(|v| v.as_str()) {
        form = form.text("quality", v.to_string());
    }
    if let Some(v) = params.get("background").and_then(|v| v.as_str()) {
        form = form.text("background", v.to_string());
    }
    if let Some(v) = params.get("output_format").and_then(|v| v.as_str()) {
        form = form.text("output_format", v.to_string());
    }
    if let Some(v) = params.get("input_fidelity").and_then(|v| v.as_str()) {
        form = form.text("input_fidelity", v.to_string());
    }
    if let Some(n) = params.get("n").and_then(|v| v.as_i64()) {
        form = form.text("n", n.to_string());
    }

    // Attach each reference image. The API accepts either "image" (single) or
    // repeated "image[]" (multiple). We always use the array form so callers
    // don't need to special-case singletons.
    for (idx, reference) in reference_images.iter().enumerate() {
        let (bytes, mime) = decode_reference(reference)?;
        let ext = mime_to_extension(&mime);
        let part = Part::bytes(bytes)
            .file_name(format!("ref{}.{}", idx, ext))
            .mime_str(&mime)
            .context("Failed to build multipart part")?;
        form = form.part("image[]", part);
    }

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(translate_error)?;

    let status = resp.status();
    let body = resp.text().await.context("Failed to read response body")?;
    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<ApiError>(&body) {
            bail!(
                "OpenAI API 错误 ({}): {}",
                status.as_u16(),
                err.error.message
            );
        }
        bail!(
            "OpenAI API 请求失败 (HTTP {}): {}",
            status.as_u16(),
            preview(&body)
        );
    }

    parse_images_response(&body, params)
}

// ============================================================================
// Response parsing
// ============================================================================

fn parse_images_response(body: &str, params: &Value) -> Result<ProviderImageOutput> {
    let parsed: ImagesResponse = serde_json::from_str(body)
        .with_context(|| format!("Failed to parse OpenAI response: {}", preview(body)))?;

    let mut images: Vec<ProviderImage> = Vec::new();
    for item in parsed.data {
        if let Some(b64) = item.b64_json {
            let bytes = BASE64
                .decode(b64.as_bytes())
                .context("Failed to decode OpenAI base64 image")?;
            images.push(ProviderImage {
                source: ProviderImageSource::Bytes(bytes),
                size: item.size,
            });
        } else if let Some(url) = item.url {
            images.push(ProviderImage {
                source: ProviderImageSource::Url(url),
                size: item.size,
            });
        }
    }

    let size = params
        .get("size")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Report a best-effort aspect ratio string from the WxH size so the gallery
    // can group/label images consistently. "auto" or unknown → empty.
    let aspect_ratio = aspect_ratio_from_size(&size);

    Ok(ProviderImageOutput {
        tokens_used: parsed.usage.map(|u| u.total_tokens).unwrap_or(0),
        images,
        // generation_type is filled in by the caller once it knows whether
        // reference images were provided (generate vs edit).
        metadata: ImageMetadata {
            generation_type: String::new(),
            aspect_ratio,
            size,
        },
    })
}

fn aspect_ratio_from_size(size: &str) -> String {
    match size {
        "1024x1024" => "1:1".to_string(),
        "1536x1024" => "3:2".to_string(),
        "1024x1536" => "2:3".to_string(),
        _ => String::new(),
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn extract_credentials(credentials: &Credentials) -> Result<(String, String)> {
    let base_url = credentials
        .get(CRED_BASE_URL)
        .filter(|v| !v.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    let api_key = credentials
        .get(CRED_API_KEY)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow!("缺少 API Key"))?
        .clone();
    Ok((base_url, api_key))
}

fn build_http_client(options: RequestOptions) -> Result<Client> {
    let mut builder = Client::builder().timeout(std::time::Duration::from_secs(600));
    if options.no_proxy {
        builder = builder.no_proxy();
    }
    builder.build().context("Failed to create HTTP client")
}

async fn send_json(client: &Client, url: &str, api_key: &str, body: &Value) -> Result<String> {
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(body)
        .send()
        .await
        .map_err(translate_error)?;

    let status = resp.status();
    let text = resp.text().await.context("Failed to read response body")?;
    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<ApiError>(&text) {
            bail!(
                "OpenAI API 错误 ({}): {}",
                status.as_u16(),
                err.error.message
            );
        }
        bail!(
            "OpenAI API 请求失败 (HTTP {}): {}",
            status.as_u16(),
            preview(&text)
        );
    }
    Ok(text)
}

fn translate_error(e: reqwest::Error) -> anyhow::Error {
    if e.is_timeout() {
        anyhow!("请求超时（服务端生成耗时过长）")
    } else if e.is_connect() {
        anyhow!("连接失败：无法访问 OpenAI API")
    } else if e.is_body() {
        // Upstream often closes the connection mid-response when generation
        // exceeds their own edge timeout. Surface it with more context.
        anyhow!(
            "服务端提前关闭了连接（通常是生成耗时超过上游的请求时限）: {}",
            e
        )
    } else {
        anyhow!("网络错误: {}", e)
    }
}

fn copy_string_param(body: &mut Value, params: &Value, key: &str) {
    if let Some(v) = params.get(key).and_then(|v| v.as_str()) {
        body[key] = json!(v);
    }
}

/// Decode a reference image passed either as a `data:*;base64,...` URL or a
/// raw base64 string. Returns (bytes, mime).
fn decode_reference(reference: &str) -> Result<(Vec<u8>, String)> {
    let (mime, b64_part) = if let Some(rest) = reference.strip_prefix("data:") {
        // e.g. "image/png;base64,AAAA..."
        if let Some((header, body)) = rest.split_once(',') {
            let mime = header.split(';').next().unwrap_or("image/png").to_string();
            (mime, body.to_string())
        } else {
            bail!("参考图的 data URL 格式无效")
        }
    } else {
        ("image/png".to_string(), reference.to_string())
    };

    let bytes = BASE64
        .decode(b64_part.as_bytes())
        .context("参考图 base64 解码失败")?;
    Ok((bytes, mime))
}

fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

fn preview(s: &str) -> String {
    if s.len() > 500 {
        format!("{}... (truncated)", &s[..500])
    } else {
        s.to_string()
    }
}

// ============================================================================
// API schema (subset)
// ============================================================================

#[derive(Debug, Deserialize)]
struct ImagesResponse {
    data: Vec<ImageItem>,
    #[serde(default)]
    usage: Option<UsageInfo>,
}

#[derive(Debug, Deserialize)]
struct ImageItem {
    #[serde(default)]
    b64_json: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageInfo {
    #[serde(default)]
    total_tokens: i64,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
}
