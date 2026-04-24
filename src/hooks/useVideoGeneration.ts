import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Video,
  GenerateVideoRequest,
  GenerateVideoRequestWithPaths,
  GenerateVideoResponse,
  VideoGalleryResponse,
  ReferenceImageInput,
  ImageFileInfo,
  MediaFileInfo,
} from "../types";

interface UseVideoGenerationOptions {
  onTaskComplete?: () => Promise<void> | void;
}

export function useVideoGeneration(options: UseVideoGenerationOptions = {}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVideos, setPendingVideos] = useState<Video[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pendingVideosRef = useRef<Video[]>([]);
  const onTaskCompleteRef = useRef(options.onTaskComplete);

  // Keep refs in sync with state/options
  useEffect(() => {
    pendingVideosRef.current = pendingVideos;
  }, [pendingVideos]);

  useEffect(() => {
    onTaskCompleteRef.current = options.onTaskComplete;
  }, [options.onTaskComplete]);

  const loadPendingVideos = useCallback(async () => {
    try {
      const videos = await invoke<Video[]>("get_pending_videos");
      setPendingVideos(videos);
      return videos;
    } catch (e) {
      console.error("Failed to load pending videos:", e);
      return [];
    }
  }, []);

  // Helper to read full-resolution image from file path
  const readImageFromPath = async (input: ReferenceImageInput | undefined): Promise<string | undefined> => {
    if (!input) return undefined;
    if (input.file_path) {
      try {
        const result = await invoke<ImageFileInfo>("read_image_file", { path: input.file_path });
        return result.base64;
      } catch (e) {
        console.error("Failed to read image file:", e);
        // Fallback to base64 if available
        if (input.base64) return input.base64;
        throw e;
      }
    }
    return input.base64;
  };

  // Helper to read video/audio file as base64 data URL
  const readMediaFile = async (path: string): Promise<string> => {
    const result = await invoke<MediaFileInfo>("read_media_file", { path });
    return result.base64;
  };

  const generateVideo = useCallback((request: GenerateVideoRequestWithPaths) => {
    // Create a temporary ID for immediate display
    const tempId = crypto.randomUUID();

    // Read a few UI-visible params directly from the params bag so the
    // optimistic preview is accurate.
    const resolution = typeof request.params?.resolution === "string" ? (request.params.resolution as string) : undefined;
    const aspectRatio = typeof request.params?.aspect_ratio === "string" ? (request.params.aspect_ratio as string) : undefined;
    const duration = typeof request.params?.duration === "number" ? (request.params.duration as number) : undefined;

    // Add to state IMMEDIATELY - same pattern as image generation
    const newVideo: Video = {
      id: tempId,
      task_id: "",
      project_id: request.project_id,
      prompt: request.prompt,
      model: "",
      generation_type: request.generation_type,
      status: "pending" as const,
      created_at: new Date().toISOString(),
      resolution,
      duration,
      aspect_ratio: aspectRatio,
      asset_types: [],
    };
    setPendingVideos((prev) => [newVideo, ...prev]);

    // Run file reading + API call in background (don't await)
    (async () => {
      setGenerating(true);
      setError(null);
      try {
        const [firstFrame, lastFrame, refImages, refVideos, refAudios] = await Promise.all([
          readImageFromPath(request.first_frame_input),
          readImageFromPath(request.last_frame_input),
          Promise.all((request.reference_image_inputs || []).map(input => readImageFromPath(input))),
          Promise.all((request.reference_video_paths || []).map(path => readMediaFile(path))),
          Promise.all((request.reference_audio_paths || []).map(path => readMediaFile(path))),
        ]);

        const finalRequest: GenerateVideoRequest = {
          project_id: request.project_id,
          provider_type: request.provider_type,
          prompt: request.prompt,
          first_frame: firstFrame,
          last_frame: lastFrame,
          reference_images: refImages.filter((img): img is string => !!img),
          reference_videos: refVideos.length > 0 ? refVideos : undefined,
          reference_audios: refAudios.length > 0 ? refAudios : undefined,
          params: request.params,
          source_image_id: request.source_image_id,
        };

        const response = await invoke<GenerateVideoResponse>("generate_video", {
          request: finalRequest,
        });

        // Update the temp video with real ID from backend
        setPendingVideos((prev) =>
          prev.map((v) =>
            v.id === tempId
              ? { ...v, id: response.id, task_id: response.task_id }
              : v
          )
        );
      } catch (e) {
        setError(String(e));
        // Mark as failed
        setPendingVideos((prev) =>
          prev.map((v) =>
            v.id === tempId
              ? { ...v, status: "failed" as const, error_message: String(e) }
              : v
          )
        );
      } finally {
        setGenerating(false);
      }
    })();
  }, []);

  const pollVideoTask = useCallback(async (id: string) => {
    try {
      const video = await invoke<Video>("poll_video_task", { id });

      // Check if this video just completed (was pending/processing, now completed)
      const prevVideo = pendingVideosRef.current.find(v => v.id === id);
      const justCompleted = prevVideo &&
        (prevVideo.status === "pending" || prevVideo.status === "processing") &&
        (video.status === "completed" || video.status === "failed");

      // Update video in list (keep it visible, don't filter out)
      setPendingVideos((prev) =>
        prev.map((v) => (v.id === id ? video : v))
      );

      // If just completed, wait for gallery refresh then remove
      if (justCompleted) {
        (async () => {
          await onTaskCompleteRef.current?.();
          setPendingVideos((prev) => prev.filter((v) => v.id !== id));
        })();
      }

      return video;
    } catch (e) {
      throw new Error(`Failed to poll video task: ${e}`);
    }
  }, []);

  const getVideos = useCallback(async (projectId: string, page: number = 0, pageSize: number = 20) => {
    try {
      const response = await invoke<VideoGalleryResponse>("get_videos", {
        projectId,
        page,
        pageSize,
      });
      return response;
    } catch (e) {
      throw new Error(`Failed to load videos: ${e}`);
    }
  }, []);

  const getVideosByAssetType = useCallback(async (projectId: string, assetType: string, page: number = 0, pageSize: number = 20) => {
    try {
      const response = await invoke<VideoGalleryResponse>("get_videos_by_asset_type", {
        projectId,
        assetType,
        page,
        pageSize,
      });
      return response;
    } catch (e) {
      throw new Error(`Failed to load videos by asset type: ${e}`);
    }
  }, []);

  const getVideoDetail = useCallback(async (id: string) => {
    try {
      const video = await invoke<Video | null>("get_video_detail", { id });
      return video;
    } catch (e) {
      throw new Error(`Failed to load video detail: ${e}`);
    }
  }, []);

  const deleteVideo = useCallback(async (id: string, deleteFile: boolean = true) => {
    try {
      await invoke<boolean>("delete_video", { id, deleteFile });
      setPendingVideos((prev) => prev.filter((v) => v.id !== id));
    } catch (e) {
      throw new Error(`Failed to delete video: ${e}`);
    }
  }, []);

  const addVideoTag = useCallback(async (id: string, assetType: string) => {
    try {
      await invoke<boolean>("add_video_tag", { id, assetType });
    } catch (e) {
      throw new Error(`Failed to add video tag: ${e}`);
    }
  }, []);

  const removeVideoTag = useCallback(async (id: string, assetType: string) => {
    try {
      await invoke<boolean>("remove_video_tag", { id, assetType });
    } catch (e) {
      throw new Error(`Failed to remove video tag: ${e}`);
    }
  }, []);

  // Start polling for pending videos
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    // Poll existing pending videos without overwriting state
    const pollExisting = async () => {
      // Get current pending videos from state (via ref to avoid stale closure)
      const currentPending = pendingVideosRef.current;
      for (const video of currentPending) {
        // Only poll videos that have a real task_id (not temp videos still being submitted)
        if ((video.status === "pending" || video.status === "processing") && video.task_id) {
          try {
            await pollVideoTask(video.id);
          } catch (e) {
            console.warn(`Failed to poll video ${video.id}:`, e);
          }
        }
      }
    };

    pollingRef.current = setInterval(pollExisting, 10000); // Poll every 10 seconds
    // Don't poll immediately - let optimistic update show first
  }, [pollVideoTask]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Auto-start polling if there are pending videos
  useEffect(() => {
    if (pendingVideos.length > 0) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [pendingVideos.length, startPolling, stopPolling]);

  // Load pending videos on mount
  useEffect(() => {
    loadPendingVideos();
  }, [loadPendingVideos]);

  return {
    generating,
    error,
    pendingVideos,
    generateVideo,
    pollVideoTask,
    loadPendingVideos,
    getVideos,
    getVideosByAssetType,
    getVideoDetail,
    deleteVideo,
    addVideoTag,
    removeVideoTag,
    startPolling,
    stopPolling,
  };
}
