import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGallery, useFiles, useVideoGeneration } from "../../hooks";
import type { GalleryImage, GenerationTask, ImageBundle, AssetType, Video as VideoType } from "../../types";
import { TaskCard, TaskImagePreview } from "../Generation";
import { ImageBundleCard } from "./ImageBundleCard";
import { BundleImagePreview } from "./BundleImagePreview";
import { VideoTaskCard, VideoPreview } from "../Video";
import {
  Search,
  X,
  Trash2,
  ImageIcon,
  Loader2,
  ExternalLink,
  FolderOpen,
  User,
  Mountain,
  Palette,
  Package,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Helper type for gallery items (either single image or bundle)
type GalleryItem =
  | { type: "single"; image: GalleryImage }
  | { type: "bundle"; bundle: ImageBundle };

// Asset type icons
const assetTypeIcons: Record<AssetType, React.ElementType> = {
  character: User,
  background: Mountain,
  style: Palette,
  prop: Package,
};

// Asset type labels in Chinese
const assetTypeLabels: Record<AssetType, string> = {
  character: "角色",
  background: "背景",
  style: "风格",
  prop: "道具",
};

interface GalleryPageProps {
  projectId: string;
  filter?: "images" | "videos" | "all";
  tasks?: GenerationTask[];
  onRetryTask?: (taskId: string) => void;
  onDismissTask?: (taskId: string) => void;
  refreshTrigger?: number;
  onRefreshComplete?: () => void;
  selectedAssetType?: AssetType | null;
  onRemoveTag?: (imageId: string, assetType: AssetType) => void;
  onRemoveVideoTag?: (videoId: string, assetType: AssetType) => void;
  pendingVideos?: VideoType[];
  onDeleteVideo?: (id: string) => void;
  onFileDeleted?: (filePath: string) => void;
}

export function GalleryPage({
  projectId,
  filter = "all",
  tasks = [],
  onRetryTask,
  onDismissTask,
  refreshTrigger = 0,
  onRefreshComplete,
  selectedAssetType = null,
  onRemoveTag,
  onRemoveVideoTag,
  pendingVideos = [],
  onDeleteVideo,
  onFileDeleted,
}: GalleryPageProps) {
  const {
    images,
    total,
    hasMore,
    loading,
    loadGallery,
    loadGalleryByAssetType,
    searchGallery,
    deleteImage,
    readImageRaw,
  } = useGallery();
  const { openFile, revealFile } = useFiles();
  const { getVideos, deleteVideo: deleteVideoFromDb } = useVideoGeneration();

  const [searchQuery, setSearchQuery] = useState("");

  // Video state
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [videosHasMore, setVideosHasMore] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videoPage, setVideoPage] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState<VideoType | null>(null);
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [fullImage, setFullImage] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [modalConfirmDelete, setModalConfirmDelete] = useState(false);
  const [bundleToDelete, setBundleToDelete] = useState<ImageBundle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Task image preview state
  const [previewTask, setPreviewTask] = useState<GenerationTask | null>(null);

  // Bundle preview state
  const [previewBundle, setPreviewBundle] = useState<ImageBundle | null>(null);

  // Handle viewing task images
  const handleViewTaskImages = useCallback((task: GenerationTask) => {
    setPreviewTask(task);
  }, []);

  // Group images by batch_id
  const galleryItems = useMemo((): GalleryItem[] => {
    const items: GalleryItem[] = [];
    const batchMap = new Map<string, GalleryImage[]>();
    const processedBatchIds = new Set<string>();

    // First pass: group images by batch_id
    for (const image of images) {
      if (image.batch_id) {
        const existing = batchMap.get(image.batch_id) || [];
        existing.push(image);
        batchMap.set(image.batch_id, existing);
      }
    }

    // Second pass: create items in order (preserving chronological order)
    for (const image of images) {
      if (image.batch_id) {
        // Skip if we already processed this batch
        if (processedBatchIds.has(image.batch_id)) continue;
        processedBatchIds.add(image.batch_id);

        const batchImages = batchMap.get(image.batch_id) || [];
        if (batchImages.length > 1) {
          // Create a bundle
          items.push({
            type: "bundle",
            bundle: {
              batch_id: image.batch_id,
              images: batchImages,
              prompt: batchImages[0].prompt,
              created_at: batchImages[0].created_at,
            },
          });
        } else {
          // Single image with batch_id (shouldn't happen, but handle it)
          items.push({ type: "single", image });
        }
      } else {
        // No batch_id - single image
        items.push({ type: "single", image });
      }
    }

    return items;
  }, [images]);

  // Load images
  useEffect(() => {
    if (filter === "videos") return; // Don't load images in video mode
    const load = async () => {
      if (selectedAssetType) {
        await loadGalleryByAssetType(projectId, selectedAssetType, 0, 20, true);
      } else {
        await loadGallery(projectId, 0, 20, true);
      }
      onRefreshComplete?.();
    };
    load();
    setPage(0);
  }, [loadGallery, loadGalleryByAssetType, projectId, refreshTrigger, onRefreshComplete, selectedAssetType, filter]);

  // Load videos
  const loadVideos = useCallback(async (page: number = 0) => {
    setVideosLoading(true);
    try {
      const response = await getVideos(projectId, page, 20);
      if (page === 0) {
        setVideos(response.videos);
      } else {
        setVideos(prev => [...prev, ...response.videos]);
      }
      setVideosHasMore(response.has_more);
    } catch (e) {
      toast.error(`加载视频失败: ${e}`);
    } finally {
      setVideosLoading(false);
    }
  }, [getVideos, projectId]);

  useEffect(() => {
    if (filter === "images") return; // Don't load videos in images-only mode
    loadVideos(0);
    setVideoPage(0);
    if (filter === "videos") {
      onRefreshComplete?.();
    }
  }, [filter, projectId, refreshTrigger, loadVideos, onRefreshComplete]);

  const handleLoadMoreVideos = useCallback(async () => {
    const nextPage = videoPage + 1;
    await loadVideos(nextPage);
    setVideoPage(nextPage);
  }, [videoPage, loadVideos]);

  const handleDeleteVideo = useCallback(async (id: string) => {
    // Find the video to get file paths before deletion
    const video = videos.find(v => v.id === id) || pendingVideos.find(v => v.id === id);

    if (onDeleteVideo) {
      // Use parent handler (handles pendingVideos)
      onDeleteVideo(id);
    } else {
      // Fallback to local delete
      try {
        await deleteVideoFromDb(id, true);
        toast.success("视频已删除");
      } catch (e) {
        toast.error(`删除视频失败: ${e}`);
      }
    }

    // Clean up references in OptionsPanel (video file and extracted frames)
    if (video) {
      if (video.file_path) onFileDeleted?.(video.file_path);
      if (video.first_frame_path) onFileDeleted?.(video.first_frame_path);
      if (video.last_frame_path) onFileDeleted?.(video.last_frame_path);
    }

    // Also remove from local videos state (for completed videos)
    setVideos(prev => prev.filter(v => v.id !== id));
  }, [onDeleteVideo, deleteVideoFromDb, videos, pendingVideos, onFileDeleted]);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim()) {
        await searchGallery(searchQuery.trim(), 50);
      } else {
        setPage(0);
        await loadGallery(projectId, 0, 20, true);
      }
    },
    [searchQuery, searchGallery, loadGallery, projectId]
  );

  const handleLoadMore = useCallback(async () => {
    const nextPage = page + 1;
    if (selectedAssetType) {
      await loadGalleryByAssetType(projectId, selectedAssetType, nextPage, 20, true);
    } else {
      await loadGallery(projectId, nextPage, 20, true);
    }
    setPage(nextPage);
  }, [page, loadGallery, loadGalleryByAssetType, projectId, selectedAssetType]);

  const handleImageClick = useCallback(
    async (image: GalleryImage) => {
      setSelectedImage(image);
      try {
        const base64 = await readImageRaw(image.file_path);
        setFullImage(base64);
      } catch (e) {
        toast.error(`加载图片失败: ${e}`);
      }
    },
    [readImageRaw]
  );

  // Handle delete button click - toggle confirm state or delete
  const handleDeleteClick = useCallback(async (image: GalleryImage) => {
    if (confirmDeleteId === image.id) {
      // Second click - actually delete
      setIsDeleting(true);
      try {
        await deleteImage(image.id, true);
        // Clean up references in OptionsPanel
        if (image.file_path) {
          onFileDeleted?.(image.file_path);
        }
        toast.success("图片已删除");
        if (selectedImage?.id === image.id) {
          setSelectedImage(null);
          setFullImage(null);
        }
      } catch (e) {
        toast.error(`删除失败: ${e}`);
      } finally {
        setIsDeleting(false);
        setConfirmDeleteId(null);
      }
    } else {
      // First click - enter confirm state
      setConfirmDeleteId(image.id);
    }
  }, [confirmDeleteId, deleteImage, selectedImage, onFileDeleted]);

  // Reset confirm state when mouse leaves the card
  const handleMouseLeave = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  // Handle modal delete - same pattern
  const handleModalDelete = useCallback(async () => {
    if (!selectedImage) return;

    if (modalConfirmDelete) {
      // Second click - actually delete
      setIsDeleting(true);
      try {
        const filePath = selectedImage.file_path;
        await deleteImage(selectedImage.id, true);
        // Clean up references in OptionsPanel
        if (filePath) {
          onFileDeleted?.(filePath);
        }
        toast.success("图片已删除");
        setSelectedImage(null);
        setFullImage(null);
        setModalConfirmDelete(false);
      } catch (e) {
        toast.error(`删除失败: ${e}`);
      } finally {
        setIsDeleting(false);
      }
    } else {
      // First click - enter confirm state
      setModalConfirmDelete(true);
    }
  }, [selectedImage, modalConfirmDelete, deleteImage, onFileDeleted]);

  // Delete all images in a bundle
  const handleConfirmBundleDelete = useCallback(async () => {
    if (!bundleToDelete) return;

    setIsDeleting(true);
    try {
      // Collect file paths before deletion
      const filePaths = bundleToDelete.images
        .map(img => img.file_path)
        .filter((path): path is string => !!path);
      // Delete all images in the bundle
      for (const image of bundleToDelete.images) {
        await deleteImage(image.id, true);
      }
      // Clean up references in OptionsPanel
      for (const filePath of filePaths) {
        onFileDeleted?.(filePath);
      }
      toast.success(`已删除 ${bundleToDelete.images.length} 张图片`);
      // Close preview if viewing this bundle
      if (previewBundle?.batch_id === bundleToDelete.batch_id) {
        setPreviewBundle(null);
      }
    } catch (e) {
      toast.error(`删除图片组失败: ${e}`);
    } finally {
      setIsDeleting(false);
      setBundleToDelete(null);
    }
  }, [bundleToDelete, deleteImage, previewBundle, onFileDeleted]);

  const closeModal = useCallback(() => {
    setSelectedImage(null);
    setFullImage(null);
    setModalConfirmDelete(false);
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, image: GalleryImage) => {
      const data = JSON.stringify({
        type: "ai-artstation-image",
        id: image.id, // Include ID for tagging when dropped on category
        base64: image.thumbnail || null,
        file_path: image.file_path,
        width: parseInt(image.size.split("x")[0]) || 0,
        height: parseInt(image.size.split("x")[1]) || 0,
      });
      e.dataTransfer.setData("text/plain", data);
      e.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">
            {selectedAssetType
              ? ({ character: "角色", background: "背景", style: "风格", prop: "道具" }[selectedAssetType])
              : "生成历史"}
          </h1>
          <span className="text-sm text-muted-foreground">{total} 张图片</span>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="按提示词搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            搜索
          </Button>
          {searchQuery && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                setSearchQuery("");
                setPage(0);
                loadGallery(projectId, 0, 20, true);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </form>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        {filter === "videos" ? (
          // Video gallery
          pendingVideos.length === 0 && videos.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Video className="mx-auto h-16 w-16 mb-4 stroke-1" />
                <p className="text-lg font-medium">暂无视频</p>
                <p className="text-sm mt-2">生成的视频将显示在这里</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {/* Pending/processing videos */}
                {pendingVideos.map((video) => (
                  <VideoTaskCard
                    key={video.id}
                    video={video}
                    onClick={setSelectedVideo}
                    onDismiss={handleDeleteVideo}
                    onRemoveTag={onRemoveVideoTag}
                  />
                ))}
                {/* Completed videos */}
                {videos.filter(v => v.status === "completed").map((video) => (
                  <VideoTaskCard
                    key={video.id}
                    video={video}
                    onClick={setSelectedVideo}
                    onDismiss={handleDeleteVideo}
                    onRemoveTag={onRemoveVideoTag}
                  />
                ))}
              </div>
              {videosHasMore && (
                <div className="mt-6 text-center">
                  <Button
                    onClick={handleLoadMoreVideos}
                    disabled={videosLoading}
                    variant="outline"
                  >
                    {videosLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        加载中...
                      </>
                    ) : (
                      "加载更多"
                    )}
                  </Button>
                </div>
              )}
            </>
          )
        ) : tasks.length === 0 && pendingVideos.length === 0 && galleryItems.length === 0 && (filter !== "all" || videos.length === 0) ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mx-auto h-16 w-16 mb-4 stroke-1" />
              <p className="text-lg font-medium">暂无内容</p>
              <p className="text-sm mt-2">生成的图片和视频将显示在这里</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {/* Active image tasks at the top */}
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onRetry={onRetryTask || (() => {})}
                  onDismiss={onDismissTask || (() => {})}
                  onViewImages={handleViewTaskImages}
                />
              ))}
              {/* Pending video tasks */}
              {pendingVideos.map((video) => (
                <VideoTaskCard
                  key={video.id}
                  video={video}
                  onClick={setSelectedVideo}
                  onDismiss={handleDeleteVideo}
                  onRemoveTag={onRemoveVideoTag}
                />
              ))}
              {/* Completed videos (in "all" mode) */}
              {filter === "all" && videos.filter(v => v.status === "completed").map((video) => (
                <VideoTaskCard
                  key={video.id}
                  video={video}
                  onClick={setSelectedVideo}
                  onDismiss={handleDeleteVideo}
                  onRemoveTag={onRemoveVideoTag}
                />
              ))}
              {/* Completed images and bundles */}
              {galleryItems.map((item) => {
                if (item.type === "bundle") {
                  return (
                    <ImageBundleCard
                      key={item.bundle.batch_id}
                      bundle={item.bundle}
                      onView={setPreviewBundle}
                      onDelete={setBundleToDelete}
                    />
                  );
                }
                const image = item.image;
                const isConfirmingDelete = confirmDeleteId === image.id;
                return (
                  <Card
                    key={image.id}
                    className="group overflow-hidden"
                    onMouseLeave={handleMouseLeave}
                  >
                    <CardContent className="p-0 relative">
                      {image.thumbnail ? (
                        <img
                          src={image.thumbnail}
                          alt={image.prompt}
                          className="w-full aspect-square object-cover cursor-grab active:cursor-grabbing"
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, image)}
                          onClick={() => handleImageClick(image)}
                        />
                      ) : (
                        <div
                          className="w-full aspect-square bg-muted flex items-center justify-center cursor-pointer"
                          onClick={() => handleImageClick(image)}
                        >
                          <ImageIcon className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      {/* Tag badges - show at top left */}
                      {image.asset_types.length > 0 && (
                        <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-16px)] z-10">
                          {image.asset_types.map((assetType) => {
                            const Icon = assetTypeIcons[assetType as AssetType];
                            return (
                              <div
                                key={assetType}
                                className={cn(
                                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                                  "bg-black/70 text-white group/tag"
                                )}
                              >
                                <Icon className="w-2.5 h-2.5" />
                                <span>{assetTypeLabels[assetType as AssetType] || assetType}</span>
                                {onRemoveTag && (
                                  <button
                                    className="ml-0.5 opacity-0 group-hover/tag:opacity-100 hover:text-red-400 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRemoveTag(image.id, assetType as AssetType);
                                    }}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end pointer-events-none"
                      >
                        <p className="text-xs text-white line-clamp-2">
                          {image.prompt}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(image.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className={cn(
                        "absolute top-2 right-2 transition-opacity",
                        isConfirmingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}>
                        <Button
                          size={isConfirmingDelete ? "sm" : "icon"}
                          variant="destructive"
                          className={isConfirmingDelete ? "h-7 text-xs" : "h-7 w-7"}
                          disabled={isDeleting && isConfirmingDelete}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(image);
                          }}
                        >
                          {isConfirmingDelete ? (
                            isDeleting ? "..." : "确认"
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-6 text-center">
                <Button
                  onClick={handleLoadMore}
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      加载中...
                    </>
                  ) : (
                    "加载更多"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Image Preview Modal */}
      <Dialog open={!!selectedImage} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-1">
              {selectedImage?.prompt}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div
              className="relative rounded-lg overflow-hidden bg-muted flex items-center justify-center w-full"
              style={{
                aspectRatio: selectedImage?.size
                  ? (() => {
                      const [w, h] = selectedImage.size.split("x").map(Number);
                      return w && h ? w / h : 1;
                    })()
                  : 1,
                maxHeight: "60vh",
              }}
            >
              {fullImage ? (
                <img
                  src={fullImage}
                  alt={selectedImage?.prompt}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              )}
            </div>
            {selectedImage && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {selectedImage.size}
                  </span>
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {selectedImage.generation_type}
                  </span>
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {selectedImage.tokens_used} tokens
                  </span>
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {new Date(selectedImage.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => openFile(selectedImage.file_path)}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    在查看器中打开
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => revealFile(selectedImage.file_path)}
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    打开文件夹
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleModalDelete}
                    disabled={isDeleting}
                  >
                    {modalConfirmDelete ? (
                      isDeleting ? "删除中..." : "确认删除"
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Image Preview Modal */}
      <TaskImagePreview
        task={previewTask}
        open={!!previewTask}
        onOpenChange={(open) => !open && setPreviewTask(null)}
      />

      {/* Bundle Image Preview Modal */}
      <BundleImagePreview
        bundle={previewBundle}
        open={!!previewBundle}
        onOpenChange={(open) => !open && setPreviewBundle(null)}
        onOpenFile={openFile}
        onRevealFile={revealFile}
        onReadImageRaw={readImageRaw}
      />

      {/* Bundle Delete Confirmation Dialog */}
      <AlertDialog open={!!bundleToDelete} onOpenChange={(open: boolean) => !open && setBundleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除图片组</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这组中的全部 {bundleToDelete?.images.length || 0} 张图片吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBundleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                `删除 ${bundleToDelete?.images.length || 0} 张图片`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Video Preview Modal */}
      <VideoPreview
        video={selectedVideo}
        open={!!selectedVideo}
        onOpenChange={(open) => !open && setSelectedVideo(null)}
        onOpenFile={openFile}
        onRevealFile={revealFile}
        onDelete={handleDeleteVideo}
      />
    </div>
  );
}
