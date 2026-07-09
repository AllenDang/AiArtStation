import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Video } from "../../types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Video as VideoIcon, ExternalLink, FolderOpen, Trash2, Loader2, Copy } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";

interface VideoPreviewProps {
  video: Video | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onDelete?: (id: string) => void;
}

export function VideoPreview({
  video,
  open,
  onOpenChange,
  onOpenFile,
  onRevealFile,
  onDelete,
}: VideoPreviewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset confirm state when dialog closes or video changes
  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }, [open, video]);

  const handleDelete = useCallback(async () => {
    if (!video || !onDelete) return;

    if (confirmDelete) {
      // Second click - actually delete
      setIsDeleting(true);
      try {
        onDelete(video.id);
        onOpenChange(false);
      } finally {
        setIsDeleting(false);
      }
    } else {
      // First click - enter confirm state
      setConfirmDelete(true);
    }
  }, [video, confirmDelete, onDelete, onOpenChange]);

  const handleCopyPrompt = useCallback(async () => {
    if (!video) return;
    try {
      await navigator.clipboard.writeText(video.prompt);
      toast.success("提示词已复制");
    } catch (e) {
      toast.error(`复制失败: ${e}`);
    }
  }, [video]);

  if (!video) return null;

  const videoSrc = video.file_path ? convertFileSrc(video.file_path) : null;

  const generationTypeText: string = {
    "text-to-video": "文生视频",
    "image-to-video-first": "首帧生成",
    "image-to-video-both": "首尾帧生成",
    "image-to-video-ref": "参考图生成",
    "multimodal-ref": "多模态参考",
  }[video.generation_type] || video.generation_type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="line-clamp-1">{video.prompt}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video player */}
          <div className="relative rounded-lg overflow-hidden bg-black flex items-center justify-center">
            {videoSrc ? (
              <video
                src={videoSrc}
                controls
                className="max-w-full max-h-[60vh]"
                autoPlay
              />
            ) : (
              <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
                <VideoIcon className="w-12 h-12" />
                <span>视频文件不存在</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
              {generationTypeText}
            </span>
            {video.duration && video.duration > 0 && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {video.duration}秒
              </span>
            )}
            {video.resolution && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {video.resolution}
              </span>
            )}
            {video.aspect_ratio && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {video.aspect_ratio}
              </span>
            )}
            {video.fps && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {video.fps}fps
              </span>
            )}
            {video.tokens_used && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {video.tokens_used} tokens
              </span>
            )}
            {video.completed_at && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded">
                {new Date(video.completed_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Prompt */}
          <div className="flex items-start gap-2 pt-2 border-t">
            <ScrollArea className="flex-1 max-h-24">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap pr-2">
                {video.prompt}
              </p>
            </ScrollArea>
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0"
              onClick={handleCopyPrompt}
            >
              <Copy className="w-4 h-4 mr-2" />
              复制提示词
            </Button>
          </div>

          {/* Actions */}
          {video.file_path && (
            <div className="flex gap-2">
              <Button onClick={() => onOpenFile(video.file_path!)}>
                <ExternalLink className="w-4 h-4 mr-2" />
                在播放器中打开
              </Button>
              <Button
                variant="outline"
                onClick={() => onRevealFile(video.file_path!)}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                打开文件夹
              </Button>
              {onDelete && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {confirmDelete ? (
                    isDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        删除中...
                      </>
                    ) : (
                      "确认删除"
                    )
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      删除
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
