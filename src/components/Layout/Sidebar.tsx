import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  User,
  Mountain,
  Palette,
  Package,
  Image,
  Video,
  Plus,
  GripVertical,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Asset, AssetType } from "@/types";

type ViewMode = "history-images" | "history-videos" | "history-all";

interface SidebarProps {
  assetsByType: Record<AssetType, Asset[]>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAssetClick: (asset: Asset) => void;
  onAssetDragStart: (asset: Asset, e: React.DragEvent) => void;
  onImportAsset: () => void;
}

const assetTypeConfig: Record<AssetType, { label: string; icon: React.ElementType }> = {
  character: { label: "Characters", icon: User },
  background: { label: "Backgrounds", icon: Mountain },
  style: { label: "Styles", icon: Palette },
  prop: { label: "Props", icon: Package },
};

export function Sidebar({
  assetsByType,
  viewMode,
  onViewModeChange,
  onAssetClick,
  onAssetDragStart,
  onImportAsset,
}: SidebarProps) {
  const [expandedTypes, setExpandedTypes] = useState<Record<AssetType, boolean>>({
    character: true,
    background: true,
    style: true,
    prop: true,
  });

  const toggleType = (type: AssetType) => {
    setExpandedTypes((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
  };

  return (
    <div className="w-56 border-r flex flex-col bg-muted/30">
      <ScrollArea className="flex-1">
        <div className="p-3">
          {/* Assets Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Assets
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onImportAsset}
                title="Import asset"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mb-2 px-1">
              Drag images here to save as reusable references
            </p>

            {(Object.keys(assetTypeConfig) as AssetType[]).map((type) => {
              const config = assetTypeConfig[type];
              const typeAssets = assetsByType[type] || [];
              const Icon = config.icon;

              return (
                <Collapsible
                  key={type}
                  open={expandedTypes[type]}
                  onOpenChange={() => toggleType(type)}
                >
                  <CollapsibleTrigger className="flex items-center w-full py-1 px-2 rounded hover:bg-accent text-sm">
                    {expandedTypes[type] ? (
                      <ChevronDown className="h-3 w-3 mr-1" />
                    ) : (
                      <ChevronRight className="h-3 w-3 mr-1" />
                    )}
                    <Icon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    <span>{config.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {typeAssets.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-4 pl-2 border-l border-border">
                      {typeAssets.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1 px-2">
                          No assets
                        </p>
                      ) : (
                        typeAssets.map((asset) => (
                          <div
                            key={asset.id}
                            className="group flex items-center gap-2 py-1 px-2 rounded hover:bg-accent cursor-pointer text-sm"
                            onClick={() => onAssetClick(asset)}
                            draggable
                            onDragStart={(e) => onAssetDragStart(asset, e)}
                          >
                            <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                            {asset.thumbnail ? (
                              <img
                                src={asset.thumbnail}
                                alt={asset.name}
                                className="w-6 h-6 rounded object-cover"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded bg-muted flex items-center justify-center">
                                <Icon className="h-3 w-3" />
                              </div>
                            )}
                            <span className="truncate">{asset.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>

          <Separator className="my-3" />

          {/* History Section (formerly Gallery) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                History
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-2 px-1">
              All generated images and videos
            </p>
            <div className="space-y-1">
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-all"
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => onViewModeChange("history-all")}
              >
                <div className="flex items-center gap-2">
                  <Image className="h-3.5 w-3.5" />
                  <Video className="h-3.5 w-3.5 -ml-1" />
                </div>
                <span className="ml-2">All</span>
              </button>
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-images"
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => onViewModeChange("history-images")}
              >
                <Image className="h-3.5 w-3.5 mr-2" />
                <span>Images</span>
              </button>
              <button
                className={cn(
                  "flex items-center w-full py-1.5 px-2 rounded text-sm",
                  viewMode === "history-videos"
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                )}
                onClick={() => onViewModeChange("history-videos")}
              >
                <Video className="h-3.5 w-3.5 mr-2" />
                <span>Videos</span>
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
