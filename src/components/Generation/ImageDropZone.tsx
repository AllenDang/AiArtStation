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
}

export function ImageDropZone({
  images,
  onImagesChange,
  onReadImage,
  maxImages = 14,
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
          if (imageData.type === "ai-artstation-image" && images.length < maxImages) {
            // Check for duplicate by file_path
            if (imageData.file_path && images.some(img => img.file_path === imageData.file_path)) {
              return; // Already exists, skip
            }

            // If we have base64, use it directly
            if (imageData.base64) {
              const newImage: ReferenceImage = {
                id: crypto.randomUUID(),
                base64: imageData.base64,
                width: imageData.width || 0,
                height: imageData.height || 0,
                was_resized: false,
                original_width: imageData.width || 0,
                original_height: imageData.height || 0,
                file_path: imageData.file_path,
              };
              onImagesChange([...images, newImage]);
              return;
            } else if (imageData.file_path) {
              // No base64, load from file path
              setLoading(true);
              try {
                const result = await onReadImage(imageData.file_path);
                const newImage: ReferenceImage = {
                  id: crypto.randomUUID(),
                  base64: result.base64,
                  width: result.width,
                  height: result.height,
                  was_resized: result.was_resized,
                  original_width: result.original_width,
                  original_height: result.original_height,
                  file_path: imageData.file_path,
                };
                onImagesChange([...images, newImage]);
              } finally {
                setLoading(false);
              }
              return;
            }
          }
        } catch {
          // Not JSON or not our format, continue to file drop handling
        }
      }

      // Handle file drops from file system
      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (files.length === 0) return;

      setLoading(true);
      try {
        const newImages: ReferenceImage[] = [];
        for (const file of files) {
          if (images.length + newImages.length >= maxImages) break;

          try {
            // Check for duplicate by filename
            if (images.some(img => img.file_path === file.name) ||
                newImages.some(img => img.file_path === file.name)) {
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
        onImagesChange([...images, ...newImages]);
      } finally {
        setLoading(false);
      }
    },
    [images, maxImages, onImagesChange]
  );

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"],
          },
        ],
        title: "Select Reference Images",
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      setLoading(true);

      try {
        const newImages: ReferenceImage[] = [];
        for (const path of paths) {
          if (images.length + newImages.length >= maxImages) break;

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
        onImagesChange([...images, ...newImages]);
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>
          参考图片 ({images.length}/{maxImages})
        </Label>
        {images.length > 0 && (
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
          "border-2 border-dashed rounded-lg p-3 transition-colors min-h-[140px]",
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
          <div className="text-center py-4">
            <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground stroke-1" />
            <p className="mt-2 text-sm text-muted-foreground">
              拖放图片到这里或{" "}
              <button
                onClick={handleSelectFiles}
                className="text-primary hover:underline"
              >
                浏览
              </button>
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              拖放生成的图片作为参考
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.base64}
                  alt="Reference"
                  className="w-full aspect-square object-cover rounded-md"
                />
                {img.was_resized && (
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
                <Plus className="w-6 h-6 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
