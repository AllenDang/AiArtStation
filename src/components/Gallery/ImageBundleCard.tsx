import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ImageBundle } from "../../types";
import { ImageIcon, Trash2, GripVertical } from "lucide-react";

interface ImageBundleCardProps {
  bundle: ImageBundle;
  onView: (bundle: ImageBundle) => void;
  onDelete: (bundle: ImageBundle) => void;
}

export function ImageBundleCard({ bundle, onView, onDelete }: ImageBundleCardProps) {
  const images = bundle.images;
  const imageCount = images.length;

  // Show up to 4 images in a 2x2 grid
  const gridImages = images.slice(0, 4);

  const handleClick = () => {
    onView(bundle);
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Drag the first image for now
    const firstImage = images[0];
    if (!firstImage) return;

    const data = JSON.stringify({
      type: "ai-artstation-image",
      base64: firstImage.thumbnail || null,
      file_path: firstImage.file_path,
      width: parseInt(firstImage.size.split("x")[0]) || 0,
      height: parseInt(firstImage.size.split("x")[1]) || 0,
    });
    e.dataTransfer.setData("text/plain", data);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <Card className="group overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
      <CardContent className="p-0 relative" onClick={handleClick}>
        {/* 2x2 Grid */}
        <div
          className="w-full aspect-square grid grid-cols-2 grid-rows-2 gap-0.5 p-0.5 cursor-grab active:cursor-grabbing"
          draggable={true}
          onDragStart={handleDragStart}
        >
          {gridImages.map((img, idx) => (
            <div key={img.id} className="relative overflow-hidden bg-muted">
              {img.thumbnail ? (
                <img
                  src={img.thumbnail}
                  alt={`${bundle.prompt} - ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
          {/* Fill empty slots if less than 4 images */}
          {gridImages.length < 4 && Array.from({ length: 4 - gridImages.length }).map((_, idx) => (
            <div key={`empty-${idx}`} className="bg-muted/50" />
          ))}
        </div>

        {/* Image count badge */}
        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
          <ImageIcon className="w-3 h-3" />
          {imageCount}
        </div>

        {/* Drag hint */}
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <GripVertical className="w-3 h-3" />
            拖动
          </div>
        </div>

        {/* Info overlay on hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end pointer-events-none">
          <p className="text-xs text-white line-clamp-2">{bundle.prompt}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {new Date(bundle.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* Click hint */}
        <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
          点击查看
        </div>

        {/* Delete button */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="destructive"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(bundle);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
