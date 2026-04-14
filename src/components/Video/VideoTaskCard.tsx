import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Video, VideoDragData, AssetType } from "../../types";
import { Video as VideoIcon, Loader2, AlertCircle, RefreshCw, Trash2, Play, X, GripVertical, User, Mountain, Palette, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertFileSrc } from "@tauri-apps/api/core";

// Asset type icons (same as image cards)
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

interface VideoTaskCardProps {
  video: Video;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onClick?: (video: Video) => void;
  onRemoveTag?: (id: string, assetType: AssetType) => void;
}

export function VideoTaskCard({ video, onRetry, onDismiss, onClick, onRemoveTag }: VideoTaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isPending = video.status === "pending";
  const isProcessing = video.status === "processing";
  const isFailed = video.status === "failed";
  const isCompleted = video.status === "completed";

  // Check if this video has frame data and can be dragged
  const hasDragData = isCompleted && (video.first_frame_path || video.last_frame_path);

  const handleDeleteClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      setIsDeleting(true);
      onDismiss?.(video.id);
    } else {
      setConfirmDelete(true);
    }
  }, [confirmDelete, onDismiss, video.id]);

  const handleMouseLeave = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  // Drag start handler - set video frame data
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!hasDragData) {
      e.preventDefault();
      return;
    }

    const dragData: VideoDragData = {
      type: "ai-artstation-video",
      video_id: video.id,
      first_frame_path: video.first_frame_path,
      last_frame_path: video.last_frame_path,
      first_frame_thumbnail: video.first_frame_thumbnail,
      last_frame_thumbnail: video.last_frame_thumbnail,
      prompt: video.prompt,
    };

    const jsonStr = JSON.stringify(dragData);
    e.dataTransfer.setData("application/json", jsonStr);
    e.dataTransfer.setData("text/plain", jsonStr);
    e.dataTransfer.effectAllowed = "copy";
    setIsDragging(true);
  }, [hasDragData, video]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const statusText = {
    pending: "排队中...",
    processing: "生成中...",
    completed: "已完成",
    failed: "生成失败",
  }[video.status];

  const generationTypeText = {
    "text-to-video": "文生视频",
    "image-to-video-first": "首帧生成",
    "image-to-video-both": "首尾帧生成",
    "image-to-video-ref": "参考图生成",
  }[video.generation_type] || video.generation_type;

  // Convert file path to Tauri asset URL
  const videoSrc = video.file_path ? convertFileSrc(video.file_path) : null;

  return (
    <Card
      className={cn(
        "group overflow-hidden",
        hasDragData && "cursor-grab",
        isDragging && "opacity-50 cursor-grabbing"
      )}
      onMouseLeave={handleMouseLeave}
      draggable={hasDragData ? true : undefined}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <CardContent className="p-0 relative">
        {/* Square aspect ratio like image cards */}
        <div
          className={cn(
            "w-full aspect-square bg-muted flex flex-col items-center justify-center gap-2 relative",
            isCompleted && video.file_path && "cursor-pointer"
          )}
          onClick={() => isCompleted && onClick?.(video)}
        >
          {/* Pending/Processing state */}
          {(isPending || isProcessing) && (
            <>
              <VideoIcon className="w-10 h-10 text-muted-foreground/50 absolute" />
              <div className="relative z-10 flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm font-medium">{statusText}</span>
                <span className="text-xs text-muted-foreground">{generationTypeText}</span>
              </div>
            </>
          )}

          {/* Failed state */}
          {isFailed && (
            <div className="flex flex-col items-center gap-2 p-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <span className="text-sm text-destructive font-medium">{statusText}</span>
              <span className="text-xs text-muted-foreground line-clamp-2 text-center px-2">
                {video.error_message || "未知错误"}
              </span>
              <div className="flex gap-2 mt-2">
                {onRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(video.id);
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    重试
                  </Button>
                )}
                {onDismiss && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(video.id);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Completed with video - show first frame thumbnail if available, fall back to video preview */}
          {isCompleted && (video.first_frame_thumbnail || videoSrc) && (
            <>
              {video.first_frame_thumbnail ? (
                <img
                  src={video.first_frame_thumbnail}
                  alt={video.prompt}
                  className="w-full h-full object-cover absolute inset-0"
                />
              ) : (
                <video
                  src={videoSrc!}
                  className="w-full h-full object-cover absolute inset-0"
                  muted
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => {
                    const v = e.target as HTMLVideoElement;
                    v.play().catch(() => {});
                  }}
                  onMouseLeave={(e) => {
                    const v = e.target as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                />
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <Play className="w-12 h-12 text-white drop-shadow-lg" />
              </div>
            </>
          )}

          {/* Completed but no file and no thumbnail */}
          {isCompleted && !video.file_path && !video.first_frame_thumbnail && (
            <>
              <VideoIcon className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">视频文件不存在</span>
            </>
          )}

          {/* Video badge */}
          <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <VideoIcon className="w-3 h-3" />
            视频
          </div>

          {/* Asset type tags - show below video badge */}
          {video.asset_types && video.asset_types.length > 0 && (
            <div className="absolute top-10 left-2 flex flex-wrap gap-1 max-w-[calc(100%-16px)] z-10">
              {video.asset_types.map((assetType) => {
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
                          onRemoveTag(video.id, assetType as AssetType);
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

          {/* Drag indicator for completed videos with frames */}
          {hasDragData && (
            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="w-3 h-3" />
              拖拽使用帧
            </div>
          )}
        </div>

        {/* Info overlay on hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end pointer-events-none">
          <p className="text-xs text-white line-clamp-2">{video.prompt}</p>
          <div className="flex gap-2 mt-1 text-[10px] text-white/70">
            {video.duration && video.duration > 0 && <span>{video.duration}秒</span>}
            {video.resolution && <span>{video.resolution}</span>}
          </div>
        </div>

        {/* Delete button - same pattern as image cards */}
        {onDismiss && (
          <div className={cn(
            "absolute top-2 right-2 transition-opacity",
            confirmDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <Button
              size={confirmDelete ? "sm" : "icon"}
              variant="destructive"
              className={confirmDelete ? "h-7 text-xs" : "h-7 w-7"}
              disabled={isDeleting}
              onClick={handleDeleteClick}
            >
              {confirmDelete ? (
                isDeleting ? "..." : "确认"
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
