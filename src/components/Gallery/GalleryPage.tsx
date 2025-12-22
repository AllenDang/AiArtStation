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
import { useGallery, useFiles } from "../../hooks";
import type { GalleryImage, GenerationTask, ImageBundle } from "../../types";
import { TaskCard, TaskImagePreview } from "../Generation";
import { ImageBundleCard } from "./ImageBundleCard";
import { BundleImagePreview } from "./BundleImagePreview";
import {
  Search,
  X,
  Trash2,
  ImageIcon,
  Loader2,
  ExternalLink,
  FolderOpen,
  GripVertical,
} from "lucide-react";

// Helper type for gallery items (either single image or bundle)
type GalleryItem =
  | { type: "single"; image: GalleryImage }
  | { type: "bundle"; bundle: ImageBundle };

interface GalleryPageProps {
  projectId: string;
  filter?: "images" | "videos" | "all";
  tasks?: GenerationTask[];
  onRetryTask?: (taskId: string) => void;
  onDismissTask?: (taskId: string) => void;
  refreshTrigger?: number;
  onRefreshComplete?: () => void;
}

export function GalleryPage({
  projectId,
  filter: _filter = "all",
  tasks = [],
  onRetryTask,
  onDismissTask,
  refreshTrigger = 0,
  onRefreshComplete,
}: GalleryPageProps) {
  const {
    images,
    total,
    hasMore,
    loading,
    loadGallery,
    searchGallery,
    deleteImage,
    readImageRaw,
  } = useGallery();
  const { openFile, openFolder } = useFiles();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [fullImage, setFullImage] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Delete confirmation state
  const [imageToDelete, setImageToDelete] = useState<GalleryImage | null>(null);
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

  useEffect(() => {
    loadGallery(projectId, 0, 20, true).then(() => {
      onRefreshComplete?.();
    });
    setPage(0);
  }, [loadGallery, projectId, refreshTrigger, onRefreshComplete]);

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
    await loadGallery(projectId, nextPage, 20, true);
    setPage(nextPage);
  }, [page, loadGallery, projectId]);

  const handleImageClick = useCallback(
    async (image: GalleryImage) => {
      setSelectedImage(image);
      try {
        const base64 = await readImageRaw(image.file_path);
        setFullImage(base64);
      } catch (e) {
        toast.error(`Failed to load image: ${e}`);
      }
    },
    [readImageRaw]
  );

  // Show delete confirmation dialog
  const handleDeleteClick = useCallback((image: GalleryImage) => {
    setImageToDelete(image);
  }, []);

  // Actually perform the delete (single image)
  const handleConfirmDelete = useCallback(async () => {
    if (!imageToDelete) return;

    setIsDeleting(true);
    try {
      await deleteImage(imageToDelete.id, true);
      toast.success("Image deleted");
      if (selectedImage?.id === imageToDelete.id) {
        setSelectedImage(null);
        setFullImage(null);
      }
    } catch (e) {
      toast.error(`Failed to delete: ${e}`);
    } finally {
      setIsDeleting(false);
      setImageToDelete(null);
    }
  }, [imageToDelete, deleteImage, selectedImage]);

  // Delete all images in a bundle
  const handleConfirmBundleDelete = useCallback(async () => {
    if (!bundleToDelete) return;

    setIsDeleting(true);
    try {
      // Delete all images in the bundle
      for (const image of bundleToDelete.images) {
        await deleteImage(image.id, true);
      }
      toast.success(`Deleted ${bundleToDelete.images.length} images`);
      // Close preview if viewing this bundle
      if (previewBundle?.batch_id === bundleToDelete.batch_id) {
        setPreviewBundle(null);
      }
    } catch (e) {
      toast.error(`Failed to delete bundle: ${e}`);
    } finally {
      setIsDeleting(false);
      setBundleToDelete(null);
    }
  }, [bundleToDelete, deleteImage, previewBundle]);

  const closeModal = useCallback(() => {
    setSelectedImage(null);
    setFullImage(null);
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, image: GalleryImage) => {
      const data = JSON.stringify({
        type: "ai-artstation-image",
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
          <h1 className="text-xl font-bold">Generation History</h1>
          <span className="text-sm text-muted-foreground">{total} images</span>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
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
        {tasks.length === 0 && galleryItems.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mx-auto h-16 w-16 mb-4 stroke-1" />
              <p className="text-lg font-medium">No images yet</p>
              <p className="text-sm mt-2">Generated images will appear here</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {/* Active tasks at the top */}
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onRetry={onRetryTask || (() => {})}
                  onDismiss={onDismissTask || (() => {})}
                  onViewImages={handleViewTaskImages}
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
                return (
                  <Card
                    key={image.id}
                    className="group overflow-hidden"
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
                      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                          <GripVertical className="w-3 h-3" />
                          Drag
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="destructive"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(image);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
                      Loading...
                    </>
                  ) : (
                    "Load More"
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
                    Open in Viewer
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const dir = selectedImage.file_path.substring(
                        0,
                        selectedImage.file_path.lastIndexOf("/")
                      );
                      openFolder(dir);
                    }}
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Open Folder
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteClick(selectedImage)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!imageToDelete} onOpenChange={(open: boolean) => !open && setImageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        onOpenFolder={openFolder}
        onReadImageRaw={readImageRaw}
      />

      {/* Bundle Delete Confirmation Dialog */}
      <AlertDialog open={!!bundleToDelete} onOpenChange={(open: boolean) => !open && setBundleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image Bundle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all {bundleToDelete?.images.length || 0} images in this bundle? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBundleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${bundleToDelete?.images.length || 0} Images`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
