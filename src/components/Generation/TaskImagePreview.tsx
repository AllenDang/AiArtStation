import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GenerationTask } from "../../types";
import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";

interface TaskImagePreviewProps {
  task: GenerationTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskImagePreview({ task, open, onOpenChange }: TaskImagePreviewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!task || !task.images || task.images.length === 0) {
    return null;
  }

  const images = task.images;
  const selectedImage = images[selectedIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            <span className="line-clamp-1 flex-1">{task.prompt}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {images.length} 张图片
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Main image preview */}
          <div className="flex-1 flex items-center justify-center bg-muted rounded-lg overflow-hidden">
            <img
              src={selectedImage.base64_preview}
              alt={`${task.prompt} - ${selectedIndex + 1}`}
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {/* Thumbnail sidebar */}
          <ScrollArea className="w-28 flex-shrink-0">
            <div className="flex flex-col gap-2 pr-2">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedIndex(idx)}
                  className={cn(
                    "w-24 h-24 flex-shrink-0 rounded-md overflow-hidden border-2 transition-all",
                    idx === selectedIndex
                      ? "border-primary ring-2 ring-primary/50"
                      : "border-transparent hover:border-muted-foreground/50"
                  )}
                >
                  <img
                    src={img.base64_preview}
                    alt={`Thumbnail ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Image info */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t">
          <span>
            第 {selectedIndex + 1} / {images.length} 张
          </span>
          <span>{selectedImage.size}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
