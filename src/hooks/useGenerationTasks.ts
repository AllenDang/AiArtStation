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

  useEffect(() => {
    onTaskCompleteRef.current = options.onTaskComplete;
  }, [options.onTaskComplete]);

  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
  }, []);

  const readImageFromPath = async (input: ReferenceImageInput): Promise<string> => {
    let imageBase64: string;

    if (input.file_path) {
      try {
        const result = await invoke<ImageFileInfo>("read_image_file", { path: input.file_path });
        imageBase64 = result.base64;
      } catch (e) {
        console.error("Failed to read image file:", e);
        if (input.base64) {
          imageBase64 = input.base64;
        } else {
          throw e;
        }
      }
    } else {
      imageBase64 = input.base64 || "";
    }

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
      }
    }

    return imageBase64;
  };

  const startImageTask = useCallback(
    (request: GenerateImageRequestWithPaths): string => {
      const taskId = crypto.randomUUID();
      const now = new Date().toISOString();

      const placeholderRequest: GenerateImageRequest = {
        ...request,
        reference_images: [],
      };

      const newTask: GenerationTask = {
        id: taskId,
        type: "image",
        status: "starting",
        prompt: request.prompt,
        request: placeholderRequest,
        requestWithPaths: request,
        created_at: now,
      };

      setTasks((prev) => [newTask, ...prev]);

      (async () => {
        try {
          updateTask(taskId, { status: "generating" });

          const referenceImages = await Promise.all(
            request.reference_image_inputs.map(input => readImageFromPath(input))
          );

          const finalRequest: GenerateImageRequest = {
            ...request,
            reference_images: referenceImages,
          };

          const response = await invoke<GenerateImageResponse>("generate_image", {
            request: finalRequest,
          });

          updateTask(taskId, {
            status: "completed",
            images: response.images,
            tokens_used: response.tokens_used,
          });

          await onTaskCompleteRef.current?.();
          setTasks((prev) => prev.filter((t) => t.id !== taskId));
        } catch (e) {
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

  const retryTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "failed") return;

      updateTask(taskId, {
        status: "starting",
        error: undefined,
      });

      (async () => {
        try {
          updateTask(taskId, { status: "generating" });

          let finalRequest: GenerateImageRequest;

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
            finalRequest = task.request as GenerateImageRequest;
          }

          const response = await invoke<GenerateImageResponse>("generate_image", {
            request: finalRequest,
          });

          updateTask(taskId, {
            status: "completed",
            images: response.images,
            tokens_used: response.tokens_used,
          });

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

  const dismissTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const clearFinishedTasks = useCallback(() => {
    setTasks((prev) =>
      prev.filter((task) => task.status === "starting" || task.status === "generating")
    );
  }, []);

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
