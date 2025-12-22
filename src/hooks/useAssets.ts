import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import type { Asset, CreateAssetRequest, UpdateAssetRequest, AssetType } from "../types";

export function useAssets(projectId: string | null) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Asset[]>("get_assets", { projectId });
      setAssets(result);
      return result;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const createAsset = useCallback(async (request: CreateAssetRequest) => {
    setError(null);
    try {
      const asset = await invoke<Asset>("create_asset", { request });
      setAssets((prev) => [...prev, asset]);
      return asset;
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  const updateAsset = useCallback(async (id: string, request: UpdateAssetRequest) => {
    setError(null);
    try {
      await invoke<boolean>("update_asset", { id, request });
      // Refresh assets to get updated data
      await loadAssets();
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, [loadAssets]);

  const deleteAsset = useCallback(async (id: string, deleteFile: boolean = false) => {
    setError(null);
    try {
      await invoke<boolean>("delete_asset", { id, deleteFile });
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  // Group assets by type
  const assetsByType = assets.reduce<Record<AssetType, Asset[]>>(
    (acc, asset) => {
      const type = asset.asset_type as AssetType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(asset);
      return acc;
    },
    { character: [], background: [], style: [], prop: [] }
  );

  return {
    assets,
    assetsByType,
    loading,
    error,
    loadAssets,
    createAsset,
    updateAsset,
    deleteAsset,
  };
}
