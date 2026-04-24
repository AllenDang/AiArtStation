import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  ProviderDescriptor,
  ProviderInstance,
  SaveProviderRequest,
} from "../types";

export function useProviders() {
  const [providers, setProviders] = useState<ProviderInstance[]>([]);
  const [descriptors, setDescriptors] = useState<ProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ProviderInstance[]>("list_providers");
      setProviders(result);
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDescriptors = useCallback(async () => {
    const result = await invoke<ProviderDescriptor[]>("list_provider_types");
    setDescriptors(result);
    return result;
  }, []);

  const saveProvider = useCallback(
    async (request: SaveProviderRequest) => {
      const saved = await invoke<ProviderInstance>("save_provider", { request });
      await loadProviders();
      return saved;
    },
    [loadProviders],
  );

  const deleteProvider = useCallback(
    async (providerType: string) => {
      await invoke("delete_provider", { providerType });
      await loadProviders();
    },
    [loadProviders],
  );

  const testConnection = useCallback(
    async (
      providerType: string,
      credentials: Record<string, string>,
      noProxy: boolean,
    ) => {
      await invoke("test_provider_connection", {
        providerType,
        credentials,
        noProxy,
      });
    },
    [],
  );

  useEffect(() => {
    loadDescriptors().catch(() => {});
  }, [loadDescriptors]);

  return {
    providers,
    descriptors,
    loading,
    error,
    loadProviders,
    loadDescriptors,
    saveProvider,
    deleteProvider,
    testConnection,
  };
}
