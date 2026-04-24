import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import type { AppSettings } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AppSettings>("load_app_settings");
      setSettings(result);
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    setLoading(true);
    setError(null);
    try {
      await invoke("save_app_settings", { settings: next });
      setSettings(next);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const getDefaultOutputDir = useCallback(async () => {
    return invoke<string>("get_default_output_dir");
  }, []);

  return {
    settings,
    loading,
    error,
    loadSettings,
    saveSettings,
    getDefaultOutputDir,
  };
}
