import { useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  User,
  Mountain,
  Palette,
  Package,
  Image,
  Video,
  History,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetType, AssetTypeCounts } from "@/types";

type ViewMode = "history-images" | "history-videos" | "history-all";

// Data structure for dropped images
export interface DroppedImageData {
  file_path: string;
  image_id: string; // ID of the image being dropped
  thumbnail?: string;
}

interface SidebarProps {
  assetTypeCounts: AssetTypeCounts;
  viewMode: ViewMode;
  selectedAssetType: AssetType | null;
  onViewModeChange: (mode: ViewMode) => void;
  onAssetTypeSelect: (type: AssetType | null) => void;
  onDropImageToCategory?: (imageId: string, assetType: AssetType) => void;
}

const assetTypeConfig: Record<AssetType, { label: string; icon: React.ElementType }> = {
  character: { label: "角色", icon: User },
  background: { label: "背景", icon: Mountain },
  style: { label: "风格", icon: Palette },
  prop: { label: "道具", icon: Package },
};

export function Sidebar({
  assetTypeCounts,
  viewMode,
  selectedAssetType,
  onViewModeChange,
  onAssetTypeSelect,
  onDropImageToCategory,
}: SidebarProps) {
  const [dragOverType, setDragOverType] = useState<AssetType | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent, type: AssetType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(type);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, assetType: AssetType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);

    if (!onDropImageToCategory) return;

    // Try to parse the dropped data
    const textData = e.dataTransfer.getData("text/plain");
    if (textData) {
      try {
        const parsed = JSON.parse(textData);
        // Check if it's our image format
        if (parsed.type === "ai-artstation-image" && parsed.id) {
          onDropImageToCategory(parsed.id, assetType);
        }
      } catch {
        // Not JSON, ignore
      }
    }
  }, [onDropImageToCategory]);

  const getCategoryCount = (type: AssetType): number => {
    return assetTypeCounts[type] || 0;
  };

  return (
    <div className="w-56 border-r flex flex-col bg-muted/30">
      <ScrollArea className="flex-1">
        <div className="p-3">
          {/* Categories Section - for filtering and tagging */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                分类
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-2 px-1">
              拖放图片到这里进行标记
            </p>

            <div className="space-y-1">
              {(Object.keys(assetTypeConfig) as AssetType[]).map((type) => {
                const config = assetTypeConfig[type];
                const count = getCategoryCount(type);
                const Icon = config.icon;
                const isSelected = selectedAssetType === type;
                const isDragOver = dragOverType === type;

                return (
                  <button
                    key={type}
                    className={cn(
                      "flex items-center w-full py-1.5 px-2 rounded text-sm transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent",
                      isDragOver && "bg-primary/20 ring-2 ring-primary ring-dashed"
                    )}
                    onClick={() => onAssetTypeSelect(isSelected ? null : type)}
                    onDragOver={(e) => handleDragOver(e, type)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, type)}
                  >
                    <Icon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    <span>{config.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator className="my-3" />

          {/* History Section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                历史
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-2 px-1">
              所有生成的图片和视频
            </p>
            <div className="space-y-1">
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-all" && !selectedAssetType
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => {
                  onViewModeChange("history-all");
                  onAssetTypeSelect(null);
                }}
              >
                <div className="flex items-center gap-2">
                  <Image className="h-3.5 w-3.5" />
                  <Video className="h-3.5 w-3.5 -ml-1" />
                </div>
                <span className="ml-2">全部</span>
              </button>
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-images" && !selectedAssetType
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => {
                  onViewModeChange("history-images");
                  onAssetTypeSelect(null);
                }}
              >
                <Image className="h-3.5 w-3.5 mr-2" />
                <span>图片</span>
              </button>
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-videos" && !selectedAssetType
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => {
                  onViewModeChange("history-videos");
                  onAssetTypeSelect(null);
                }}
              >
                <Video className="h-3.5 w-3.5 mr-2" />
                <span>视频</span>
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
