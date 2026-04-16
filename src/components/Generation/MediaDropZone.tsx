import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { X, Plus, FileVideo, FileAudio, Video } from "lucide-react";
import type { VideoDragData } from "../../types";

export interface MediaFile {
  id: string;
  path: string;
  name: string;
  size?: number;        // file size in bytes
  thumbnail?: string;   // base64 thumbnail for video preview (first frame)
}

interface MediaDropZoneProps {
  files: MediaFile[];
  onFilesChange: (files: MediaFile[]) => void;
  maxFiles: number;
  extensions: string[];       // e.g., ["mp4", "mov"] or ["wav", "mp3"]
  label: string;
  mediaType: "video" | "audio";
  maxSizeMB?: number;         // Max file size in MB (50 for video, 15 for audio)
}

export function MediaDropZone({
  files,
  onFilesChange,
  maxFiles,
  extensions,
  label,
  mediaType,
  maxSizeMB,
}: MediaDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const Icon = mediaType === "video" ? FileVideo : FileAudio;
  const filterName = mediaType === "video" ? "Video Files" : "Audio Files";

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
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (files.length >= maxFiles) return;

      // Check for JSON data (from workspace video cards)
      const jsonData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
      if (jsonData) {
        try {
          const dragData = JSON.parse(jsonData);
          if (dragData.type === "ai-artstation-video") {
            const videoData = dragData as VideoDragData;

            if (mediaType === "video" && videoData.file_path) {
              // Video mode: add video file as reference
              if (files.some(f => f.path === videoData.file_path)) return;

              const name = videoData.file_path!.split("/").pop() || videoData.file_path!.split("\\").pop() || "video";
              const newFile: MediaFile = {
                id: crypto.randomUUID(),
                path: videoData.file_path!,
                name,
                thumbnail: videoData.first_frame_thumbnail,
              };
              onFilesChange([...files, newFile].slice(0, maxFiles));
              return;
            }

            if (mediaType === "audio") {
              // Audio mode: auto-fill separated vocals and BGM from video
              const newFiles: MediaFile[] = [];

              if (videoData.vocals_path && !files.some(f => f.path === videoData.vocals_path)) {
                const vocalsName = videoData.vocals_path.split("/").pop() || videoData.vocals_path.split("\\").pop() || "vocals.wav";
                newFiles.push({
                  id: crypto.randomUUID(),
                  path: videoData.vocals_path,
                  name: `🎤 ${vocalsName}`,
                });
              }

              if (videoData.bgm_path && !files.some(f => f.path === videoData.bgm_path)) {
                const bgmName = videoData.bgm_path.split("/").pop() || videoData.bgm_path.split("\\").pop() || "bgm.wav";
                newFiles.push({
                  id: crypto.randomUUID(),
                  path: videoData.bgm_path,
                  name: `🎵 ${bgmName}`,
                });
              }

              if (newFiles.length > 0) {
                onFilesChange([...files, ...newFiles].slice(0, maxFiles));
                return;
              }
              // No separated audio available — fall through to file drop handling
            }
          }
        } catch {
          // Not JSON or not our format, continue to file drop handling
        }
      }

      // Handle file drops from system file manager
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length === 0) return;

      const validFiles = droppedFiles.filter((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        return extensions.includes(ext);
      });

      if (validFiles.length === 0) return;

      // System file drops in Tauri v2 don't provide full paths reliably
      // Users should use the file picker for system files
      const remaining = maxFiles - files.length;
      const newFiles: MediaFile[] = validFiles.slice(0, remaining).map((file) => ({
        id: crypto.randomUUID(),
        path: "", // Will be empty for system drops — picker is recommended
        name: file.name,
        size: file.size,
      }));

      onFilesChange([...files, ...newFiles]);
    },
    [files, maxFiles, extensions, mediaType, onFilesChange]
  );

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: files.length < maxFiles - 1,
        filters: [
          {
            name: filterName,
            extensions,
          },
        ],
        title: `Select ${filterName}`,
      });

      if (!selected) return;

      const paths: string[] = Array.isArray(selected) ? selected : [selected];
      const remaining = maxFiles - files.length;

      const newFiles: MediaFile[] = paths.slice(0, remaining).map((path: string) => {
        const name = path.split("/").pop() || path.split("\\").pop() || path;
        return {
          id: crypto.randomUUID(),
          path,
          name,
        };
      });

      onFilesChange([...files, ...newFiles]);
    } catch (err) {
      console.error("Failed to select files:", err);
    }
  };

  const handleRemoveFile = (id: string) => {
    onFilesChange(files.filter((f) => f.id !== id));
  };

  const handleClearAll = () => {
    onFilesChange([]);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Video type: thumbnail grid (like ImageDropZone)
  if (mediaType === "video") {
    return (
      <div className="flex flex-col gap-2 h-full">
        <div className="flex items-center justify-between flex-shrink-0">
          <Label className="text-xs">{label}</Label>
          {files.length > 0 && (
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
          onDragEnter={(e) => e.preventDefault()}
          className={cn(
            "border-2 border-dashed rounded-lg transition-colors p-3 min-h-[140px] flex-1 min-h-0 overflow-auto",
            isDragging
              ? "border-primary bg-primary/10"
              : "border-border hover:border-muted-foreground/50"
          )}
        >
          {files.length === 0 ? (
            <div className="text-center py-4 h-full flex flex-col items-center justify-center">
              <Video className="mx-auto h-8 w-8 text-muted-foreground stroke-1" />
              <p className="mt-2 text-sm text-muted-foreground">
                拖放视频到这里或{" "}
                <button
                  onClick={handleSelectFiles}
                  className="text-primary hover:underline"
                >
                  浏览
                </button>
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                拖放生成的视频作为参考
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {files.map((file) => (
                <div key={file.id} className="relative group">
                  {file.thumbnail ? (
                    <img
                      src={file.thumbnail}
                      alt={file.name}
                      className="w-full aspect-square object-cover rounded-md"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted rounded-md flex flex-col items-center justify-center">
                      <FileVideo className="w-6 h-6 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground mt-1 px-1 truncate max-w-full">
                        {file.name}
                      </span>
                    </div>
                  )}
                  {/* Video badge */}
                  <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded flex items-center gap-0.5">
                    <Video className="w-2.5 h-2.5" />
                    {file.size ? formatSize(file.size) : ""}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(file.id);
                    }}
                    className="absolute top-1 right-1 bg-destructive text-destructive-foreground p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {files.length < maxFiles && (
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

  // Audio type: file list style
  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <Label className="text-xs">{label}</Label>
        {files.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleClearAll}
          >
            清除
          </Button>
        )}
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg transition-colors flex-1 min-h-0 overflow-auto p-2",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-muted-foreground/50"
        )}
      >
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Icon className="h-6 w-6 text-muted-foreground stroke-1" />
            <p className="mt-1 text-xs text-muted-foreground">
              拖放视频自动分离音轨，或{" "}
              <button
                onClick={handleSelectFiles}
                className="text-primary hover:underline"
              >
                选择文件
              </button>
            </p>
            {maxSizeMB && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                {extensions.join("/")} (max {maxSizeMB}MB)
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 bg-accent/50 rounded px-2 py-1 group"
              >
                <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate flex-1" title={file.name}>
                  {file.name}
                </span>
                {file.size && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {formatSize(file.size)}
                  </span>
                )}
                <button
                  onClick={() => handleRemoveFile(file.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {files.length < maxFiles && (
              <button
                onClick={handleSelectFiles}
                className="flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded hover:border-muted-foreground/50 transition-colors"
              >
                <Plus className="w-3 h-3" />
                添加
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
