import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";

export function useFiles() {
  const openFolder = useCallback(async (path: string) => {
    try {
      await invoke("open_folder", { path });
    } catch (e) {
      throw new Error(`Failed to open folder: ${e}`);
    }
  }, []);

  const openFile = useCallback(async (path: string) => {
    try {
      await invoke("open_file", { path });
    } catch (e) {
      throw new Error(`Failed to open file: ${e}`);
    }
  }, []);

  const pathExists = useCallback(async (path: string) => {
    try {
      const result = await invoke<boolean>("path_exists", { path });
      return result;
    } catch (e) {
      return false;
    }
  }, []);

  const ensureDirectory = useCallback(async (path: string) => {
    try {
      await invoke("ensure_directory", { path });
    } catch (e) {
      throw new Error(`Failed to create directory: ${e}`);
    }
  }, []);

  return {
    openFolder,
    openFile,
    pathExists,
    ensureDirectory,
  };
}
