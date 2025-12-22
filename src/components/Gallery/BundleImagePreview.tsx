import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ImageBundle } from "../../types";
import { cn } from "@/lib/utils";
import { ImageIcon, ExternalLink, FolderOpen, Loader2 } from "lucide-react";

interface BundleImagePreviewProps {
  bundle: ImageBundle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onReadImageRaw: (path: string) => Promise<string>;
}

export function BundleImagePreview({
  bundle,
  open,
  onOpenChange,
  onOpenFile,
  onOpenFolder,
  onReadImageRaw,
}: BundleImagePreviewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fullImage, setFullImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset state when bundle changes
  useEffect(() => {
    setSelectedIndex(0);
    setFullImage(null);
  }, [bundle]);

  // Load full image when selection changes
  useEffect(() => {
    if (!bundle || !open) return;

    const loadImage = async () => {
      const image = bundle.images[selectedIndex];
      if (!image) return;

      setLoading(true);
      try {
        const base64 = await onReadImageRaw(image.file_path);
        setFullImage(base64);
      } catch (e) {
        console.error("Failed to load image:", e);
        // Fall back to thumbnail
        setFullImage(image.thumbnail || null);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [bundle, selectedIndex, open, onReadImageRaw]);

  if (!bundle || bundle.images.length === 0) {
    return null;
  }

  const images = bundle.images;
  const selectedImage = images[selectedIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            <span className="line-clamp-1 flex-1">{bundle.prompt}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {images.length} images
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Main image preview */}
          <div className="flex-1 flex items-center justify-center bg-muted rounded-lg overflow-hidden relative">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            ) : fullImage ? (
              <img
                src={fullImage}
                alt={`${bundle.prompt} - ${selectedIndex + 1}`}
                className="max-w-full max-h-full object-contain"
              />
            ) : selectedImage?.thumbnail ? (
              <img
                src={selectedImage.thumbnail}
                alt={`${bundle.prompt} - ${selectedIndex + 1}`}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <ImageIcon className="w-16 h-16 text-muted-foreground" />
            )}
          </div>

          {/* Thumbnail sidebar */}
          <ScrollArea className="w-28 flex-shrink-0">
            <div className="flex flex-col gap-2 pr-2">
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedIndex(idx)}
                  className={cn(
                    "w-24 h-24 flex-shrink-0 rounded-md overflow-hidden border-2 transition-all",
                    idx === selectedIndex
                      ? "border-primary ring-2 ring-primary/50"
                      : "border-transparent hover:border-muted-foreground/50"
                  )}
                >
                  {img.thumbnail ? (
                    <img
                      src={img.thumbnail}
                      alt={`Thumbnail ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Image info and actions */}
        {selectedImage && (
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                Image {selectedIndex + 1} of {images.length}
              </span>
              <span>{selectedImage.size}</span>
              <span>{selectedImage.tokens_used} tokens</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenFile(selectedImage.file_path)}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const dir = selectedImage.file_path.substring(
                    0,
                    selectedImage.file_path.lastIndexOf("/")
                  );
                  onOpenFolder(dir);
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Folder
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
