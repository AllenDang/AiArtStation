import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import type {
  GenerateImageRequest,
  GenerateImageResponse,
  ImageFileInfo,
  PreparedImage,
} from "../types";

export function useImageGeneration() {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateImageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateImage = useCallback(async (request: GenerateImageRequest) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await invoke<GenerateImageResponse>("generate_image", {
        request,
      });
      setResult(response);
      return response;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setGenerating(false);
    }
  }, []);

  const prepareReferenceImage = useCallback(async (filePath: string) => {
    try {
      const result = await invoke<PreparedImage>("prepare_reference_image", {
        filePath,
      });
      return result;
    } catch (e) {
      throw new Error(`Failed to prepare image: ${e}`);
    }
  }, []);

  const readImageFile = useCallback(async (path: string) => {
    try {
      const result = await invoke<ImageFileInfo>("read_image_file", { path });
      return result;
    } catch (e) {
      throw new Error(`Failed to read image: ${e}`);
    }
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    generating,
    result,
    error,
    generateImage,
    prepareReferenceImage,
    readImageFile,
    clearResult,
  };
}
