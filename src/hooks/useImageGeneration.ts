import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { ImageFileInfo, PreparedImage } from "../types";

export function useImageGeneration() {
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

  return {
    prepareReferenceImage,
    readImageFile,
  };
}
