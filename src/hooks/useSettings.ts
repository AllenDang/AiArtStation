import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import type { ConfigResponse, SaveConfigRequest } from "../types";

export function useSettings() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ConfigResponse>("load_settings");
      setConfig(result);
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (request: SaveConfigRequest) => {
    setLoading(true);
    setError(null);
    try {
      await invoke("save_settings", { request });
      // Reload settings after save
      const result = await invoke<ConfigResponse>("load_settings");
      setConfig(result);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("test_connection");
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("clear_settings");
      setConfig(null);
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
    config,
    loading,
    error,
    loadSettings,
    saveSettings,
    testConnection,
    clearSettings,
    getDefaultOutputDir,
  };
}
