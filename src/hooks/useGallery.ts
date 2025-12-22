import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import type { GalleryImage, GalleryResponse } from "../types";

export function useGallery() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGallery = useCallback(
    async (projectId: string, page: number = 0, pageSize: number = 20, includeThumbnails: boolean = true) => {
      setLoading(true);
      setError(null);
      try {
        const response = await invoke<GalleryResponse>("get_gallery", {
          projectId,
          page,
          pageSize,
          includeThumbnails,
        });
        if (page === 0) {
          setImages(response.images);
        } else {
          setImages((prev) => [...prev, ...response.images]);
        }
        setTotal(response.total);
        setHasMore(response.has_more);
        return response;
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const searchGallery = useCallback(async (query: string, limit: number = 50) => {
    setLoading(true);
    setError(null);
    try {
      const results = await invoke<GalleryImage[]>("search_gallery", {
        query,
        limit,
      });
      setImages(results);
      setTotal(results.length);
      setHasMore(false);
      return results;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const getImageDetail = useCallback(async (id: string) => {
    try {
      const result = await invoke<GalleryImage | null>("get_image_detail", { id });
      return result;
    } catch (e) {
      throw new Error(`Failed to get image detail: ${e}`);
    }
  }, []);

  const deleteImage = useCallback(
    async (id: string, deleteFile: boolean = true) => {
      try {
        await invoke<boolean>("delete_gallery_image", { id, deleteFile });
        setImages((prev) => prev.filter((img) => img.id !== id));
        setTotal((prev) => prev - 1);
      } catch (e) {
        throw new Error(`Failed to delete image: ${e}`);
      }
    },
    []
  );

  const readImageRaw = useCallback(async (path: string) => {
    try {
      const result = await invoke<string>("read_image_raw", { path });
      return result;
    } catch (e) {
      throw new Error(`Failed to read image: ${e}`);
    }
  }, []);

  return {
    images,
    total,
    hasMore,
    loading,
    error,
    loadGallery,
    searchGallery,
    getImageDetail,
    deleteImage,
    readImageRaw,
  };
}
