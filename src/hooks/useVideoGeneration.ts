import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Video,
  GenerateVideoRequest,
  GenerateVideoResponse,
  VideoGalleryResponse,
} from "../types";

export function useVideoGeneration() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVideos, setPendingVideos] = useState<Video[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const generateVideo = useCallback(async (request: GenerateVideoRequest) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await invoke<GenerateVideoResponse>("generate_video", {
        request,
      });
      // Refresh pending videos to include new task
      await loadPendingVideos();
      return response;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setGenerating(false);
    }
  }, []);

  const pollVideoTask = useCallback(async (id: string) => {
    try {
      const video = await invoke<Video>("poll_video_task", { id });
      // Update pending videos list
      setPendingVideos((prev) =>
        prev.map((v) => (v.id === id ? video : v)).filter(
          (v) => v.status === "pending" || v.status === "processing"
        )
      );
      return video;
    } catch (e) {
      throw new Error(`Failed to poll video task: ${e}`);
    }
  }, []);

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

  // Start polling for pending videos
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    const poll = async () => {
      const pending = await loadPendingVideos();
      for (const video of pending) {
        await pollVideoTask(video.id);
      }
    };

    pollingRef.current = setInterval(poll, 10000); // Poll every 10 seconds
    poll(); // Initial poll
  }, [loadPendingVideos, pollVideoTask]);

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
    getVideoDetail,
    deleteVideo,
    startPolling,
    stopPolling,
  };
}
