import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ReferenceImage } from "../../types";
import { ImagePlus, X, Plus, Loader2 } from "lucide-react";

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
}

export function ImageDropZone({
  images,
  onImagesChange,
  onReadImage,
  maxImages = 14,
  label,
  compact = false,
  singleImageFill = false,
}: ImageDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

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

      // Check for image data (from generated results or history)
      const textData = e.dataTransfer.getData("text/plain");
      if (textData) {
        try {
          const imageData = JSON.parse(textData);
          // Verify it's our image data format
          // For singleImageFill, always allow (will replace). Otherwise check limit.
          if (imageData.type === "ai-artstation-image" && (singleImageFill || images.length < maxImages)) {
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
    [images, maxImages, onImagesChange, singleImageFill]
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
          "border-2 border-dashed rounded-lg transition-colors",
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
              src={images[0].base64}
              alt="Reference"
              className="w-full h-full object-cover rounded-md"
            />
            {images[0].was_resized && (
              <div className="absolute bottom-1 left-1 bg-yellow-500/90 text-black text-[10px] px-1 rounded font-medium">
                已缩放
              </div>
            )}
            <button
              onClick={() => handleRemoveImage(images[0].id)}
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
                  src={img.base64}
                  alt="Reference"
                  className="w-full aspect-square object-cover rounded-md"
                />
                {img.was_resized && !compact && (
                  <div className="absolute bottom-1 left-1 bg-yellow-500/90 text-black text-[10px] px-1 rounded font-medium">
                    已缩放
                  </div>
                )}
                <button
                  onClick={() => handleRemoveImage(img.id)}
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
      </div>
    </div>
  );
}
