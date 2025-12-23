import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Video } from "../../types";
import { Video as VideoIcon, Loader2, AlertCircle, RefreshCw, Trash2, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertFileSrc } from "@tauri-apps/api/core";

interface VideoTaskCardProps {
  video: Video;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onClick?: (video: Video) => void;
}

export function VideoTaskCard({ video, onRetry, onDismiss, onClick }: VideoTaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isPending = video.status === "pending";
  const isProcessing = video.status === "processing";
  const isFailed = video.status === "failed";
  const isCompleted = video.status === "completed";

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
    <Card className="group overflow-hidden" onMouseLeave={handleMouseLeave}>
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

          {/* Completed with video - show thumbnail if available, fall back to video preview */}
          {isCompleted && (video.thumbnail || videoSrc) && (
            <>
              {video.thumbnail ? (
                <img
                  src={video.thumbnail}
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
          {isCompleted && !video.file_path && !video.thumbnail && (
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
        </div>

        {/* Info overlay on hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end pointer-events-none">
          <p className="text-xs text-white line-clamp-2">{video.prompt}</p>
          <div className="flex gap-2 mt-1 text-[10px] text-white/70">
            {video.duration && <span>{video.duration}秒</span>}
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
