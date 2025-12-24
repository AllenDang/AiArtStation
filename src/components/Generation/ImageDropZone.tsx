import { useCallback, useState, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ReferenceImage, VideoDragData, DropZoneType, MaskData } from "../../types";
import { ImagePlus, X, Plus, Loader2, Video } from "lucide-react";

interface ImageDropZoneProps {
  images: ReferenceImage[];
  onImagesChange: (images: ReferenceImage[]) => void;
  onReadImage: (path: string) => Promise<{
    base64: string;
    width: number;
    height: number;
    was_resized: boolean;
    original_width: number;
    original_height: number;
  }>;
  maxImages?: number;
  label?: string;
  compact?: boolean;
  singleImageFill?: boolean; // When true and maxImages=1, image fills the container
  // Video drag support
  dropZoneType?: DropZoneType;
  // Callback for coordinated video frame drops (first-last mode)
  onVideoFrameDrop?: (first?: ReferenceImage, last?: ReferenceImage) => void;
  // Mask support for painter feature
  imageMasks?: Map<string, MaskData>;
  onImageClick?: (image: ReferenceImage) => void;
}

export function ImageDropZone({
  images,
  onImagesChange,
  onReadImage,
  maxImages = 14,
  label,
  compact = false,
  singleImageFill = false,
  dropZoneType = "image-ref",
  onVideoFrameDrop,
  imageMasks,
  onImageClick,
}: ImageDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  // State for video frame selection menu
  const [pendingVideoData, setPendingVideoData] = useState<VideoDragData | null>(null);

  // Get display image - use mask thumbnail if exists, otherwise original thumbnail
  const getDisplayImage = useCallback((img: ReferenceImage): string => {
    const mask = imageMasks?.get(img.id);
    return mask?.thumbnail_with_mask || img.base64;
  }, [imageMasks]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLDivElement>(null);

  // Helper to create a ReferenceImage from video frame data
  const createRefImageFromFrame = useCallback((
    thumbnail?: string,
    path?: string
  ): ReferenceImage | null => {
    if (!thumbnail && !path) return null;
    return {
      id: crypto.randomUUID(),
      base64: thumbnail || "", // Use thumbnail for preview
      width: 0,
      height: 0,
      was_resized: false,
      original_width: 0,
      original_height: 0,
      file_path: path, // Store path for full-res loading
    };
  }, []);

  // Handle video frame selection from menu
  const handleFrameSelect = useCallback((frame: "first" | "last") => {
    if (!pendingVideoData) return;

    const thumbnail = frame === "first"
      ? pendingVideoData.first_frame_thumbnail
      : pendingVideoData.last_frame_thumbnail;
    const path = frame === "first"
      ? pendingVideoData.first_frame_path
      : pendingVideoData.last_frame_path;

    const newImage = createRefImageFromFrame(thumbnail, path);
    if (newImage) {
      onImagesChange(singleImageFill ? [newImage] : [...images, newImage]);
    }

    setPendingVideoData(null);
    setMenuOpen(false);
  }, [pendingVideoData, createRefImageFromFrame, onImagesChange, singleImageFill, images]);

  // Handle video drop for different zone types
  const handleVideoDrop = useCallback((videoData: VideoDragData) => {
    const firstImage = createRefImageFromFrame(
      videoData.first_frame_thumbnail,
      videoData.first_frame_path
    );
    const lastImage = createRefImageFromFrame(
      videoData.last_frame_thumbnail,
      videoData.last_frame_path
    );

    switch (dropZoneType) {
      case "image-ref":
      case "video-ref":
        // Add both frames as references
        const newImages: ReferenceImage[] = [];
        if (firstImage) newImages.push(firstImage);
        if (lastImage) newImages.push(lastImage);
        if (newImages.length > 0) {
          const remaining = maxImages - images.length;
          onImagesChange([...images, ...newImages.slice(0, remaining)]);
        }
        break;

      case "video-first":
      case "video-last":
        // Show menu to let user pick which frame
        if (firstImage || lastImage) {
          setPendingVideoData(videoData);
          setMenuOpen(true);
        }
        break;

      case "video-both-first":
        // Auto-fill with first frame, coordinate with last frame zone
        if (firstImage) {
          onImagesChange([firstImage]);
        }
        // Also trigger coordinated drop for last frame zone
        if (onVideoFrameDrop) {
          onVideoFrameDrop(firstImage || undefined, lastImage || undefined);
        }
        break;

      case "video-both-last":
        // Auto-fill with last frame
        if (lastImage) {
          onImagesChange([lastImage]);
        }
        break;
    }
  }, [dropZoneType, createRefImageFromFrame, images, maxImages, onImagesChange, onVideoFrameDrop]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // Check for JSON data (from generated results, history, or videos)
      const jsonData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
      if (jsonData) {
        try {
          const dragData = JSON.parse(jsonData);

          // Handle video drops
          if (dragData.type === "ai-artstation-video") {
            handleVideoDrop(dragData as VideoDragData);
            return;
          }

          // Handle image drops - verify it's our image data format
          // For singleImageFill, always allow (will replace). Otherwise check limit.
          if (dragData.type === "ai-artstation-image" && (singleImageFill || images.length < maxImages)) {
            const imageData = dragData;
            // Check for duplicate by file_path (skip for singleImageFill as it replaces)
            if (!singleImageFill && imageData.file_path && images.some(img => img.file_path === imageData.file_path)) {
              return; // Already exists, skip
            }

            // Use thumbnail for fast preview, store file_path for generation
            if (imageData.base64 || imageData.file_path) {
              const newImage: ReferenceImage = {
                id: crypto.randomUUID(),
                base64: imageData.base64 || "", // Thumbnail for preview
                width: imageData.width || 0,
                height: imageData.height || 0,
                was_resized: false,
                original_width: imageData.width || 0,
                original_height: imageData.height || 0,
                file_path: imageData.file_path, // Store path for full-res loading during generation
              };
              onImagesChange(singleImageFill ? [newImage] : [...images, newImage]);
              return;
            }
          }
        } catch {
          // Not JSON or not our format, continue to file drop handling
        }
      }

      // Handle file drops from file system
      let files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (files.length === 0) return;

      // For singleImageFill, only take the first file
      if (singleImageFill) {
        files = [files[0]];
      }

      setLoading(true);
      try {
        const newImages: ReferenceImage[] = [];
        for (const file of files) {
          // For singleImageFill, skip limit check (we're replacing)
          if (!singleImageFill && images.length + newImages.length >= maxImages) break;

          try {
            // Check for duplicate by filename (skip for singleImageFill as it replaces)
            if (!singleImageFill && (images.some(img => img.file_path === file.name) ||
                newImages.some(img => img.file_path === file.name))) {
              continue; // Already exists, skip
            }

            // Read file content directly using FileReader (works without file path)
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });

            // Get image dimensions
            const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve({ width: img.width, height: img.height });
              img.onerror = () => reject(new Error("Failed to load image"));
              img.src = base64;
            });

            newImages.push({
              id: crypto.randomUUID(),
              base64,
              width: dimensions.width,
              height: dimensions.height,
              was_resized: false,
              original_width: dimensions.width,
              original_height: dimensions.height,
              file_path: file.name, // Only have filename, not full path
            });
          } catch (err) {
            console.error("Failed to process image:", err);
          }
        }
        // For singleImageFill, replace instead of append
        onImagesChange(singleImageFill ? newImages : [...images, ...newImages]);
      } finally {
        setLoading(false);
      }
    },
    [images, maxImages, onImagesChange, singleImageFill, handleVideoDrop]
  );

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: !singleImageFill, // Single selection for singleImageFill mode
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"],
          },
        ],
        title: singleImageFill ? "Select Image" : "Select Reference Images",
      });

      if (!selected) return;

      let paths = Array.isArray(selected) ? selected : [selected];
      // For singleImageFill, only take the first path
      if (singleImageFill) {
        paths = [paths[0]];
      }
      setLoading(true);

      try {
        const newImages: ReferenceImage[] = [];
        for (const path of paths) {
          // For singleImageFill, skip limit check (we're replacing)
          if (!singleImageFill && images.length + newImages.length >= maxImages) break;

          try {
            const result = await onReadImage(path);
            newImages.push({
              id: crypto.randomUUID(),
              base64: result.base64,
              width: result.width,
              height: result.height,
              was_resized: result.was_resized,
              original_width: result.original_width,
              original_height: result.original_height,
              file_path: path,
            });
          } catch (err) {
            console.error("Failed to process image:", err);
          }
        }
        // For singleImageFill, replace instead of append
        onImagesChange(singleImageFill ? newImages : [...images, ...newImages]);
      } finally {
        setLoading(false);
      }
    } catch (err) {
      console.error("Failed to select files:", err);
    }
  };

  const handleRemoveImage = (id: string) => {
    onImagesChange(images.filter((img) => img.id !== id));
  };

  const handleClearAll = () => {
    onImagesChange([]);
  };

  const displayLabel = label || `参考图片 (${images.length}/${maxImages})`;

  return (
    <div className={cn("flex flex-col", singleImageFill ? "h-full gap-1" : "gap-2")}>
      <div className="flex items-center justify-between flex-shrink-0">
        <Label className={cn(compact ? "text-xs" : "", singleImageFill && "text-xs")}>
          {displayLabel}
        </Label>
        {images.length > 0 && !compact && !singleImageFill && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleClearAll}
          >
            清除全部
          </Button>
        )}
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnter={(e) => {
          e.preventDefault();
        }}
        className={cn(
          "border-2 border-dashed rounded-lg transition-colors relative",
          singleImageFill
            ? "p-1 flex-1 min-h-0 overflow-hidden"
            : compact
              ? "p-2 min-h-[80px]"
              : "p-3 min-h-[140px]",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-muted-foreground/50",
          loading && "opacity-50 pointer-events-none"
        )}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {images.length === 0 ? (
          <div className={cn("text-center", compact ? "py-2" : "py-4", singleImageFill && "h-full flex flex-col items-center justify-center")}>
            <ImagePlus className={cn("mx-auto text-muted-foreground stroke-1", compact ? "h-6 w-6" : "h-8 w-8")} />
            <p className={cn("mt-2 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
              {compact || singleImageFill ? (
                <button
                  onClick={handleSelectFiles}
                  className="text-primary hover:underline"
                >
                  选择图片
                </button>
              ) : (
                <>
                  拖放图片到这里或{" "}
                  <button
                    onClick={handleSelectFiles}
                    className="text-primary hover:underline"
                  >
                    浏览
                  </button>
                </>
              )}
            </p>
            {!compact && !singleImageFill && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                拖放生成的图片作为参考
              </p>
            )}
          </div>
        ) : singleImageFill && images.length === 1 ? (
          // Single image fill mode - image fills the container
          <div className="relative group h-full">
            <img
              src={getDisplayImage(images[0])}
              alt="Reference"
              className={cn(
                "w-full h-full object-cover rounded-md",
                onImageClick && "cursor-pointer"
              )}
              onClick={() => onImageClick?.(images[0])}
              title={onImageClick ? "Click to edit mask" : undefined}
            />
            {images[0].was_resized && (
              <div className="absolute bottom-1 left-1 bg-yellow-500/90 text-black text-[10px] px-1 rounded font-medium">
                已缩放
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveImage(images[0].id);
              }}
              className="absolute top-1 right-1 bg-destructive text-destructive-foreground p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-4")}>
            {images.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={getDisplayImage(img)}
                  alt="Reference"
                  className={cn(
                    "w-full aspect-square object-cover rounded-md",
                    onImageClick && "cursor-pointer"
                  )}
                  onClick={() => onImageClick?.(img)}
                  title={onImageClick ? "Click to edit mask" : undefined}
                />
                {img.was_resized && !compact && (
                  <div className="absolute bottom-1 left-1 bg-yellow-500/90 text-black text-[10px] px-1 rounded font-medium">
                    已缩放
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(img.id);
                  }}
                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {images.length < maxImages && (
              <button
                onClick={handleSelectFiles}
                className="aspect-square border-2 border-dashed border-border rounded-md flex items-center justify-center hover:border-muted-foreground/50 hover:bg-accent transition-colors"
              >
                <Plus className={cn("text-muted-foreground", compact ? "w-4 h-4" : "w-6 h-6")} />
              </button>
            )}
          </div>
        )}

        {/* Frame selection dropdown - positioned at top center of drop zone */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <div ref={menuTriggerRef} className="absolute top-2 left-1/2 -translate-x-1/2 w-0 h-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-[160px]">
            <div className="px-2 py-1.5 text-sm font-semibold flex items-center gap-2">
              <Video className="w-4 h-4" />
              选择帧
            </div>
            {pendingVideoData?.first_frame_thumbnail && (
              <DropdownMenuItem onClick={() => handleFrameSelect("first")}>
                <div className="flex items-center gap-2">
                  <img
                    src={pendingVideoData.first_frame_thumbnail}
                    alt="First frame"
                    className="w-8 h-8 object-cover rounded"
                  />
                  <span>使用首帧</span>
                </div>
              </DropdownMenuItem>
            )}
            {pendingVideoData?.last_frame_thumbnail && (
              <DropdownMenuItem onClick={() => handleFrameSelect("last")}>
                <div className="flex items-center gap-2">
                  <img
                    src={pendingVideoData.last_frame_thumbnail}
                    alt="Last frame"
                    className="w-8 h-8 object-cover rounded"
                  />
                  <span>使用尾帧</span>
                </div>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
