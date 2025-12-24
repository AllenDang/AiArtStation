import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useRef, useEffect } from "react";
import type {
  GenerationTask,
  GenerateImageRequest,
  GenerateImageRequestWithPaths,
  GenerateImageResponse,
  ReferenceImageInput,
  ImageFileInfo,
} from "../types";

interface UseGenerationTasksOptions {
  onTaskComplete?: () => Promise<void> | void;
}

export function useGenerationTasks(options: UseGenerationTasksOptions = {}) {
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const onTaskCompleteRef = useRef(options.onTaskComplete);

  // Keep ref updated
  useEffect(() => {
    onTaskCompleteRef.current = options.onTaskComplete;
  }, [options.onTaskComplete]);

  // Helper to update a specific task
  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
  }, []);

  // Helper to read full-resolution image from file path and optionally combine with mask
  const readImageFromPath = async (input: ReferenceImageInput): Promise<string> => {
    let imageBase64: string;

    if (input.file_path) {
      try {
        const result = await invoke<ImageFileInfo>("read_image_file", { path: input.file_path });
        imageBase64 = result.base64;
      } catch (e) {
        console.error("Failed to read image file:", e);
        // Fallback to base64 if available
        if (input.base64) {
          imageBase64 = input.base64;
        } else {
          throw e;
        }
      }
    } else {
      imageBase64 = input.base64 || "";
    }

    // Combine with mask if present (for inpainting/editing workflows)
    if (input.mask_base64 && input.file_path) {
      try {
        const combinedBase64 = await invoke<string>("combine_image_with_mask", {
          imagePath: input.file_path,
          maskBase64: input.mask_base64,
          combineMode: "overlay",
        });
        return combinedBase64;
      } catch (e) {
        console.error("Failed to combine mask:", e);
        // Fall back to image without mask
      }
    }

    return imageBase64;
  };

  // Start a new image generation task
  const startImageTask = useCallback(
    (request: GenerateImageRequestWithPaths): string => {
      const taskId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Create placeholder request for task storage (actual reference_images will be filled later)
      const placeholderRequest: GenerateImageRequest = {
        ...request,
        reference_images: [], // Will be filled after file reading
      };

      // Create task with "starting" status - IMMEDIATELY
      const newTask: GenerationTask = {
        id: taskId,
        type: "image",
        status: "starting",
        prompt: request.prompt,
        request: placeholderRequest,
        requestWithPaths: request, // Store for retry
        created_at: now,
      };

      setTasks((prev) => [newTask, ...prev]);

      // Run file reading + generation asynchronously (in background)
      (async () => {
        try {
          // Update to "generating" while reading files
          updateTask(taskId, { status: "generating" });

          // Read full-resolution images from file paths
          const referenceImages = await Promise.all(
            request.reference_image_inputs.map(input => readImageFromPath(input))
          );

          // Build final request with base64 images
          const finalRequest: GenerateImageRequest = {
            ...request,
            reference_images: referenceImages,
          };

          // Call the Tauri command
          const response = await invoke<GenerateImageResponse>("generate_image", {
            request: finalRequest,
          });

          // Update task to show the completed image preview
          updateTask(taskId, {
            status: "completed",
            images: response.images,
            tokens_used: response.tokens_used,
          });

          // Wait for gallery to refresh, then remove the task
          await onTaskCompleteRef.current?.();
          setTasks((prev) => prev.filter((t) => t.id !== taskId));
        } catch (e) {
          // Update to "failed" with error
          updateTask(taskId, {
            status: "failed",
            error: String(e),
          });
        }
      })();

      return taskId;
    },
    [updateTask]
  );

  // Retry a failed task
  const retryTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "failed") return;

      // Reset task status
      updateTask(taskId, {
        status: "starting",
        error: undefined,
      });

      // Run generation again (re-read files from paths if available)
      (async () => {
        try {
          updateTask(taskId, { status: "generating" });

          let finalRequest: GenerateImageRequest;

          // Use requestWithPaths if available (re-read files)
          if (task.requestWithPaths && 'reference_image_inputs' in task.requestWithPaths) {
            const requestWithPaths = task.requestWithPaths as GenerateImageRequestWithPaths;
            const referenceImages = await Promise.all(
              requestWithPaths.reference_image_inputs.map(input => readImageFromPath(input))
            );
            finalRequest = {
              ...requestWithPaths,
              reference_images: referenceImages,
            };
          } else {
            // Fallback to stored request
            finalRequest = task.request as GenerateImageRequest;
          }

          const response = await invoke<GenerateImageResponse>("generate_image", {
            request: finalRequest,
          });

          // Update task to show the completed image preview
          updateTask(taskId, {
            status: "completed",
            images: response.images,
            tokens_used: response.tokens_used,
          });

          // Wait for gallery to refresh, then remove the task
          await onTaskCompleteRef.current?.();
          setTasks((prev) => prev.filter((t) => t.id !== taskId));
        } catch (e) {
          updateTask(taskId, {
            status: "failed",
            error: String(e),
          });
        }
      })();
    },
    [tasks, updateTask]
  );

  // Dismiss (remove) a task
  const dismissTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  // Clear all completed/failed tasks
  const clearFinishedTasks = useCallback(() => {
    setTasks((prev) =>
      prev.filter((task) => task.status === "starting" || task.status === "generating")
    );
  }, []);

  // Check if any tasks are running
  const hasRunningTasks = tasks.some(
    (task) => task.status === "starting" || task.status === "generating"
  );

  return {
    tasks,
    startImageTask,
    retryTask,
    dismissTask,
    clearFinishedTasks,
    hasRunningTasks,
  };
}
