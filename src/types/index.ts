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
export type VideoGenerationType = "text-to-video" | "image-to-video-first" | "image-to-video-both" | "image-to-video-ref";
export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export interface Video {
  id: string;
  project_id?: string;
  task_id: string;
  file_path?: string;
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
}

export interface GenerateVideoRequest {
  project_id: string;
  prompt: string;
  generation_type: VideoGenerationType;
  first_frame?: string;     // Base64
  last_frame?: string;      // Base64
  reference_images?: string[]; // Base64 array for multi-ref
  resolution?: string;      // "480p", "720p", "1080p"
  duration?: number;        // 2-12 seconds
  aspect_ratio?: string;    // "16:9", "4:3", "1:1", etc.
  source_image_id?: string; // Parent image ID if applicable
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

// API Configuration
export interface ConfigResponse {
  base_url: string;
  api_token_set: boolean;
  image_model: string;
  video_model: string;
  output_directory: string;
  output_format: string;
  organize_by_date: boolean;
  save_metadata: boolean;
  default_size: string;
  default_aspect_ratio: string;
  watermark: boolean;
}

export interface SaveConfigRequest {
  base_url: string;
  api_token: string;
  image_model: string;
  video_model: string;
  output_directory: string;
  output_format: string;
  organize_by_date: boolean;
  save_metadata: boolean;
  default_size?: string;
  default_aspect_ratio?: string;
  watermark?: boolean;
}

// Image Generation
export interface GenerateImageRequest {
  project_id: string;
  prompt: string;
  reference_images: string[];
  size?: string;
  aspect_ratio?: string;
  watermark?: boolean;
  // Sequential generation (组图)
  sequential_generation?: boolean;
  max_images?: number;
  // Prompt optimization
  optimize_prompt?: boolean;
  optimize_prompt_mode?: "standard" | "fast";
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
  created_at: string;
}

// Size options
export const SIZE_OPTIONS = [
  { label: "2K", value: "2K" },
  { label: "4K", value: "4K" },
] as const;

export const ASPECT_RATIO_OPTIONS = [
  { label: "1:1", value: "1:1", dimensions: "2048x2048" },
  { label: "4:3", value: "4:3", dimensions: "2304x1728" },
  { label: "3:4", value: "3:4", dimensions: "1728x2304" },
  { label: "16:9", value: "16:9", dimensions: "2560x1440" },
  { label: "9:16", value: "9:16", dimensions: "1440x2560" },
  { label: "3:2", value: "3:2", dimensions: "2496x1664" },
  { label: "2:3", value: "2:3", dimensions: "1664x2496" },
  { label: "21:9", value: "21:9", dimensions: "3024x1296" },
] as const;
