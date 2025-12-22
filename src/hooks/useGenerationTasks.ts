import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useRef, useEffect } from "react";
import type {
  GenerationTask,
  GenerateImageRequest,
  GenerateImageResponse,
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

  // Start a new image generation task
  const startImageTask = useCallback(
    async (request: GenerateImageRequest): Promise<string> => {
      const taskId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Create task with "starting" status
      const newTask: GenerationTask = {
        id: taskId,
        type: "image",
        status: "starting",
        prompt: request.prompt,
        request,
        created_at: now,
      };

      setTasks((prev) => [newTask, ...prev]);

      // Run generation asynchronously
      (async () => {
        try {
          // Update to "generating"
          updateTask(taskId, { status: "generating" });

          // Call the Tauri command
          const response = await invoke<GenerateImageResponse>("generate_image", {
            request,
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

      // Run generation again
      (async () => {
        try {
          updateTask(taskId, { status: "generating" });

          const response = await invoke<GenerateImageResponse>("generate_image", {
            request: task.request as GenerateImageRequest,
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
