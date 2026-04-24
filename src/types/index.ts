// Project Types
export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  image_count: number;
  video_count: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name: string;
  description?: string;
}

// Asset Types
export type AssetType = "character" | "background" | "style" | "prop";

export interface Asset {
  id: string;
  project_id: string;
  name: string;
  asset_type: AssetType;
  tags: string[];
  file_path: string;
  thumbnail?: string;
  created_at: string;
}

export interface CreateAssetRequest {
  project_id: string;
  name: string;
  asset_type: AssetType;
  tags: string[];
  file_path: string;
}

export interface UpdateAssetRequest {
  name: string;
  asset_type: AssetType;
  tags: string[];
}

// Video Types
export type VideoGenerationType = "text-to-video" | "image-to-video-first" | "image-to-video-both" | "image-to-video-ref" | "multimodal-ref";
export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export interface Video {
  id: string;
  project_id?: string;
  task_id: string;
  file_path?: string;
  first_frame_thumbnail?: string;  // Base64 thumbnail for preview
  last_frame_thumbnail?: string;   // Base64 thumbnail for preview
  first_frame_path?: string;       // Full-res frame file path
  last_frame_path?: string;        // Full-res frame file path
  vocals_path?: string;            // Separated vocals audio path
  bgm_path?: string;               // Separated BGM/accompaniment audio path
  prompt: string;
  model: string;
  generation_type: VideoGenerationType;
  source_image_id?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  aspect_ratio?: string;
  status: VideoStatus;
  error_message?: string;
  tokens_used?: number;
  created_at: string;
  completed_at?: string;
  asset_types: AssetType[];  // Tags for categorization
}

// Video drag data for dropping videos to reference zones
export interface VideoDragData {
  type: "ai-artstation-video";
  video_id: string;
  file_path?: string;              // Video file path for use as reference
  first_frame_path?: string;
  last_frame_path?: string;
  first_frame_thumbnail?: string;  // For preview
  last_frame_thumbnail?: string;
  vocals_path?: string;            // Separated vocals audio path
  bgm_path?: string;               // Separated BGM audio path
  prompt: string;
}

// Drop zone type for different reference image contexts
export type DropZoneType =
  | "image-ref"        // Image generation reference zone (add both frames as refs)
  | "video-first"      // Video first-frame zone (show menu to pick first or last)
  | "video-last"       // Video last-frame zone (show menu to pick first or last)
  | "video-both-first" // Video first-last mode: first frame zone
  | "video-both-last"  // Video first-last mode: last frame zone
  | "video-ref";       // Video reference images zone (add both as refs)

export interface GenerateVideoRequest {
  project_id: string;
  provider_type: string;
  prompt: string;
  first_frame?: string;              // Base64
  last_frame?: string;               // Base64
  reference_images?: string[];       // Base64 array for multi-ref
  reference_videos?: string[];       // Base64 data URLs for reference videos
  reference_audios?: string[];       // Base64 data URLs for reference audios
  /// Provider-specific parameters rendered from the manifest
  params: Record<string, unknown>;
  source_image_id?: string;
}

// Request with file paths - for hooks to process
export interface GenerateVideoRequestWithPaths extends Omit<GenerateVideoRequest, 'first_frame' | 'last_frame' | 'reference_images' | 'reference_videos' | 'reference_audios'> {
  first_frame_input?: ReferenceImageInput;
  last_frame_input?: ReferenceImageInput;
  reference_image_inputs?: ReferenceImageInput[];
  reference_video_paths?: string[];  // File paths to video files
  reference_audio_paths?: string[];  // File paths to audio files
  // UI-visible generation_type derived from params (kept for video preview routing)
  generation_type: VideoGenerationType;
}

export interface GenerateVideoResponse {
  id: string;
  task_id: string;
  status: string;
}

export interface VideoGalleryResponse {
  videos: Video[];
  total: number;
  has_more: boolean;
}

// ============================================================================
// App Settings (non-provider preferences)
// ============================================================================

export interface AppSettings {
  output_directory: string;
  output_format: string;
  default_image_provider_type?: string | null;
  default_video_provider_type?: string | null;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface ProviderCapabilities {
  image: boolean;
  video: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  required: boolean;
}

export interface ProviderDescriptor {
  provider_type: string;
  display_name: string;
  capabilities: ProviderCapabilities;
  credential_schema: CredentialField[];
  image_manifest?: GenerationManifest | null;
  video_manifest?: GenerationManifest | null;
}

export interface ProviderInstance {
  provider_type: string;
  credentials: Record<string, string>;
  image_model?: string | null;
  video_model?: string | null;
  no_proxy: boolean;
}

export interface SaveProviderRequest {
  provider_type: string;
  credentials: Record<string, string>;
  image_model?: string | null;
  video_model?: string | null;
  no_proxy: boolean;
}

export interface EnumOption {
  value: unknown;
  label: string;
  description?: string;
}

export interface VisibleWhen {
  field: string;
  equals?: unknown;
  in_values?: unknown[];
}

export type ParamField =
  | {
      type: "enum";
      key: string;
      label: string;
      options: EnumOption[];
      default: unknown;
      visible_when?: VisibleWhen;
    }
  | {
      type: "number";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: unknown;
      visible_when?: VisibleWhen;
    }
  | {
      type: "boolean";
      key: string;
      label: string;
      default: boolean;
      visible_when?: VisibleWhen;
    }
  | {
      type: "string";
      key: string;
      label: string;
      placeholder?: string;
      default?: unknown;
      visible_when?: VisibleWhen;
    };

export interface Features {
  reference_images?: number;
  first_frame?: boolean;
  last_frame?: boolean;
  reference_videos?: number;
  reference_audios?: number;
  mask?: boolean;
}

export interface GenerationManifest {
  params: ParamField[];
  features: Features;
  generation_type_key?: string | null;
}

// Reference image input - can be either base64 or file path
export interface ReferenceImageInput {
  base64?: string;      // Pre-encoded base64
  file_path?: string;   // Path to read full-res image from
  mask_base64?: string; // Optional mask to combine with image (processed in background)
}

// Image Generation
export interface GenerateImageRequest {
  project_id: string;
  provider_type: string;
  prompt: string;
  reference_images: string[];        // Final base64 strings sent to API
  /// Provider-specific parameters rendered from the manifest
  params: Record<string, unknown>;
}

// Request with file paths - for hooks to process
export interface GenerateImageRequestWithPaths extends Omit<GenerateImageRequest, 'reference_images'> {
  reference_image_inputs: ReferenceImageInput[];
}

export interface GeneratedImageInfo {
  id: string;
  file_path: string;
  size: string;
  base64_preview: string;
}

export interface GenerateImageResponse {
  images: GeneratedImageInfo[];
  tokens_used: number;
}

// Media File Processing (video/audio)
export interface MediaFileInfo {
  base64: string;
  file_size: number;
  mime_type: string;
}

// Image File Processing
export interface ImageFileInfo {
  base64: string;
  width: number;
  height: number;
  file_size: number;
  was_resized: boolean;
  original_width: number;
  original_height: number;
}

export interface PreparedImage {
  base64: string;
  width: number;
  height: number;
  was_resized: boolean;
  original_width: number;
  original_height: number;
}

// Gallery
export interface GalleryImage {
  id: string;
  project_id?: string;
  batch_id?: string; // Groups sequential images together
  file_path: string;
  prompt: string;
  model: string;
  size: string;
  aspect_ratio: string;
  generation_type: string;
  tokens_used: number;
  created_at: string;
  thumbnail?: string;
  asset_types: AssetType[]; // Multiple tags allowed for categorization/filtering
}

// Asset type counts for sidebar
export interface AssetTypeCounts {
  character: number;
  background: number;
  style: number;
  prop: number;
}

// Image bundle for grouped sequential images
export interface ImageBundle {
  batch_id: string;
  images: GalleryImage[];
  prompt: string;
  created_at: string;
}

export interface GalleryResponse {
  images: GalleryImage[];
  total: number;
  has_more: boolean;
}

// Reference Image (for UI state)
export interface ReferenceImage {
  id: string;
  base64: string;
  width: number;
  height: number;
  was_resized: boolean;
  original_width: number;
  original_height: number;
  file_path?: string;
}

// Mask data for image painter feature
export interface MaskData {
  image_id: string;              // Reference image ID (matches ReferenceImage.id)
  image_path: string;            // Original image file path
  mask_base64: string;           // PNG with transparency (mask pixels only)
  mask_width: number;            // Same as original image width
  mask_height: number;           // Same as original image height
  thumbnail_with_mask: string;   // Composited thumbnail for display in reference zone
  created_at: number;            // Timestamp
  updated_at: number;            // Last modified timestamp
}

// Painter tool types
export type PainterTool = "brush" | "eraser";

// Painter state for undo/redo
export interface PainterHistoryEntry {
  mask_data: ImageData;  // Canvas ImageData snapshot
  timestamp: number;
}

// Generation Task Types
export type TaskStatus = "starting" | "generating" | "completed" | "failed";
export type TaskType = "image" | "video";

export interface GenerationTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  prompt: string;
  progress?: number;
  error?: string;
  images?: GeneratedImageInfo[];
  tokens_used?: number;
  request: GenerateImageRequest | GenerateVideoRequest;
  // Store original request with paths for retry
  requestWithPaths?: GenerateImageRequestWithPaths | GenerateVideoRequestWithPaths;
  created_at: string;
}

// OptionsPanel ref handle for external cleanup
export interface OptionsPanelHandle {
  cleanupDeletedFile: (filePath: string) => void;
}
