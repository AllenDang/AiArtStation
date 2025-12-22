import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { GenerationTask, GenerateImageRequest } from "../../types";
import { Loader2, RefreshCw, X, CheckCircle2, XCircle, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: GenerationTask;
  onRetry: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onViewImages?: (task: GenerationTask) => void;
}

export function TaskCard({ task, onRetry, onDismiss, onViewImages }: TaskCardProps) {
  const isRunning = task.status === "starting" || task.status === "generating";
  const isCompleted = task.status === "completed";
  const isFailed = task.status === "failed";

  // Get expected image count for sequential generation
  const request = task.request as GenerateImageRequest;
  const isSequential = request.sequential_generation;
  const maxImages = request.max_images || 15;
  const isAutoMode = maxImages === 15; // 15 is used for auto mode
  const actualCount = task.images?.length || 0;

  // For completed tasks with multiple images, show up to 4 in a grid
  const showGrid = isCompleted && actualCount > 1;
  const gridImages = task.images?.slice(0, 4) || [];

  const handleCardClick = () => {
    if (isCompleted && actualCount > 0 && onViewImages) {
      onViewImages(task);
    }
  };

  return (
    <Card className={cn(
      "group overflow-hidden transition-all",
      isRunning && "ring-2 ring-primary/50",
      isFailed && "ring-2 ring-destructive/50",
      isCompleted && actualCount > 0 && "cursor-pointer hover:ring-2 hover:ring-primary/50"
    )}>
      <CardContent className="p-0 relative" onClick={handleCardClick}>
        {/* Image/Status Area */}
        <div className="w-full aspect-square bg-muted flex items-center justify-center relative">
          {/* Running state */}
          {isRunning && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-xs">
                {task.status === "starting" ? "Starting..." : "Generating..."}
              </span>
              {isSequential && (
                <span className="text-xs text-muted-foreground">
                  {isAutoMode ? `Up to ${maxImages} images` : `${maxImages} images`}
                </span>
              )}
            </div>
          )}

          {/* Completed with multiple images - show 2x2 grid */}
          {showGrid && (
            <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-0.5 p-0.5">
              {gridImages.map((img, idx) => (
                <div key={idx} className="relative overflow-hidden">
                  <img
                    src={img.base64_preview}
                    alt={`${task.prompt} - ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
              {/* Fill empty slots if less than 4 images */}
              {gridImages.length < 4 && Array.from({ length: 4 - gridImages.length }).map((_, idx) => (
                <div key={`empty-${idx}`} className="bg-muted/50" />
              ))}
            </div>
          )}

          {/* Completed with single image */}
          {isCompleted && actualCount === 1 && task.images && (
            <img
              src={task.images[0].base64_preview}
              alt={task.prompt}
              className="w-full h-full object-cover"
            />
          )}

          {/* Completed with no images */}
          {isCompleted && actualCount === 0 && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
              <span className="text-xs">Completed</span>
            </div>
          )}

          {/* Failed state */}
          {isFailed && (
            <div
              className="flex flex-col items-center gap-2 text-destructive p-4 cursor-help"
              title={task.error || "Generation failed"}
            >
              <XCircle className="w-8 h-8" />
              <span className="text-xs text-center line-clamp-4 px-2">
                {task.error || "Generation failed"}
              </span>
            </div>
          )}

          {/* Image count badge - show when more than shown in grid */}
          {isCompleted && actualCount > 1 && (
            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />
              {actualCount}
            </div>
          )}

          {/* Status badge */}
          <div className={cn(
            "absolute top-2 left-2 text-xs px-2 py-1 rounded flex items-center gap-1",
            isRunning && "bg-primary text-primary-foreground",
            isCompleted && "bg-green-500 text-white",
            isFailed && "bg-destructive text-destructive-foreground"
          )}>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
            {isCompleted && <CheckCircle2 className="w-3 h-3" />}
            {isFailed && <XCircle className="w-3 h-3" />}
            {task.status === "starting" && "Starting"}
            {task.status === "generating" && "Generating"}
            {task.status === "completed" && "Done"}
            {task.status === "failed" && "Failed"}
          </div>

          {/* Click hint for completed tasks with images */}
          {isCompleted && actualCount > 0 && (
            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
              Click to view
            </div>
          )}
        </div>

        {/* Info overlay on hover - only for non-grid views */}
        {!showGrid && (
          <div className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity p-2 flex flex-col justify-end pointer-events-none">
            <p className="text-xs text-white line-clamp-2">{task.prompt}</p>
            {task.tokens_used && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {task.tokens_used} tokens
              </p>
            )}
          </div>
        )}

        {/* Action buttons - always visible for failed, hover for others */}
        {!isRunning && (
          <div className={cn(
            "absolute bottom-2 right-2 flex gap-1 transition-opacity",
            isFailed ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            {isFailed && (
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}
                title="Retry"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onDismiss(task.id); }}
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
