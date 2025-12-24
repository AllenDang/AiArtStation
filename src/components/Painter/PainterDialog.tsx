import { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PainterCanvas, PainterCanvasHandle } from "./PainterCanvas";
import { PainterToolbar } from "./PainterToolbar";
import { usePainterState } from "./usePainterState";
import type { PainterTool, MaskData, ReferenceImage } from "../../types";
import { Loader2 } from "lucide-react";

// Helper to load mask from base64 PNG to ImageData
async function loadMaskFromBase64(base64: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve(imageData);
    };
    img.onerror = () => reject(new Error("Failed to load mask image"));
    img.src = base64;
  });
}

interface PainterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: ReferenceImage;
  existingMask?: MaskData | null;
  onSave: (maskData: MaskData) => void;
  onReadFullImage: (path: string) => Promise<string>;
}

export function PainterDialog({
  open,
  onOpenChange,
  image,
  existingMask,
  onSave,
  onReadFullImage,
}: PainterDialogProps) {
  const canvasRef = useRef<PainterCanvasHandle>(null);

  // Tool state
  const [tool, setTool] = useState<PainterTool>("brush");
  const [brushSize, setBrushSize] = useState(20);
  const [brushColor, setBrushColor] = useState("#FF0000");
  const [brushOpacity, setBrushOpacity] = useState(80);
  const [zoom, setZoom] = useState(1);

  // Image loading state
  const [fullImageBase64, setFullImageBase64] = useState<string | null>(null);
  const [initialMaskData, setInitialMaskData] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // History state
  const { canUndo, canRedo, undo, redo, pushState, clear: clearHistory } = usePainterState();

  // Load full resolution image and existing mask when dialog opens
  useEffect(() => {
    if (!open) return;

    const loadImage = async () => {
      setLoading(true);
      setError(null);
      setInitialMaskData(null);

      try {
        // Load full image
        let imageBase64: string;
        if (!image.file_path) {
          imageBase64 = image.base64;
        } else {
          imageBase64 = await onReadFullImage(image.file_path);
        }
        setFullImageBase64(imageBase64);

        // Load existing mask if any
        if (existingMask?.mask_base64) {
          const maskImageData = await loadMaskFromBase64(existingMask.mask_base64);
          setInitialMaskData(maskImageData);
        }
      } catch (e) {
        setError(`加载图片失败: ${e}`);
        // Fallback to thumbnail
        setFullImageBase64(image.base64);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [open, image.file_path, image.base64, onReadFullImage, existingMask]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setFullImageBase64(null);
      clearHistory();
    }
  }, [open, clearHistory]);

  // Handle mask change (push to history)
  const handleMaskChange = useCallback(
    (maskData: ImageData) => {
      pushState(maskData);
    },
    [pushState]
  );

  // Handle undo
  const handleUndo = useCallback(() => {
    const data = undo();
    if (data && canvasRef.current) {
      canvasRef.current.setMaskData(data);
    }
  }, [undo]);

  // Handle redo
  const handleRedo = useCallback(() => {
    const data = redo();
    if (data && canvasRef.current) {
      canvasRef.current.setMaskData(data);
    }
  }, [redo]);

  // Handle clear
  const handleClear = useCallback(() => {
    if (canvasRef.current) {
      canvasRef.current.clearMask();
      // Push empty state
      const emptyData = new ImageData(image.original_width, image.original_height);
      pushState(emptyData);
    }
  }, [image.original_width, image.original_height, pushState]);

  // Handle zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(5, z * 1.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.1, z / 1.2));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  // Update zoom from canvas
  const updateZoom = useCallback(() => {
    if (canvasRef.current) {
      setZoom(canvasRef.current.getZoom());
    }
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setTool("brush");
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setTool("eraser");
      } else if (e.key === "[") {
        e.preventDefault();
        setBrushSize((s) => Math.max(1, s - 5));
      } else if (e.key === "]") {
        e.preventDefault();
        setBrushSize((s) => Math.min(200, s + 5));
      } else if (ctrlKey && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        handleRedo();
      } else if (ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleUndo, handleRedo, onOpenChange]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!canvasRef.current) return;

    const maskData = canvasRef.current.getMaskData();
    if (!maskData) return;

    // Convert mask to PNG base64
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskData.width;
    maskCanvas.height = maskData.height;
    const ctx = maskCanvas.getContext("2d")!;
    ctx.putImageData(maskData, 0, 0);
    const maskBase64 = maskCanvas.toDataURL("image/png");

    // Create composited thumbnail
    const thumbnailCanvas = document.createElement("canvas");
    const thumbSize = 256; // Thumbnail size
    const scale = Math.min(thumbSize / image.original_width, thumbSize / image.original_height);
    thumbnailCanvas.width = Math.round(image.original_width * scale);
    thumbnailCanvas.height = Math.round(image.original_height * scale);
    const thumbCtx = thumbnailCanvas.getContext("2d")!;

    // Draw original thumbnail
    const thumbImg = new Image();
    thumbImg.onload = () => {
      thumbCtx.drawImage(thumbImg, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);

      // Draw mask overlay with semi-transparency
      const maskImg = new Image();
      maskImg.onload = () => {
        thumbCtx.globalAlpha = 0.6;
        thumbCtx.drawImage(maskImg, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
        const thumbnailWithMask = thumbnailCanvas.toDataURL("image/png");

        const now = Date.now();
        const savedMaskData: MaskData = {
          image_id: image.id,
          image_path: image.file_path || "",
          mask_base64: maskBase64,
          mask_width: maskData.width,
          mask_height: maskData.height,
          thumbnail_with_mask: thumbnailWithMask,
          created_at: existingMask?.created_at || now,
          updated_at: now,
        };

        onSave(savedMaskData);
        onOpenChange(false);
      };
      maskImg.src = maskBase64;
    };
    thumbImg.src = image.base64;
  }, [image, existingMask, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle>编辑蒙版</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
          {/* Toolbar */}
          <PainterToolbar
            tool={tool}
            onToolChange={setTool}
            brushSize={brushSize}
            onBrushSizeChange={setBrushSize}
            brushColor={brushColor}
            onBrushColorChange={setBrushColor}
            brushOpacity={brushOpacity}
            onBrushOpacityChange={setBrushOpacity}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClear={handleClear}
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={handleZoomReset}
          />

          {/* Canvas Area */}
          <div className="flex-1 min-h-0" onMouseUp={updateZoom}>
            {loading ? (
              <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
                <p className="text-destructive">{error}</p>
              </div>
            ) : fullImageBase64 ? (
              <PainterCanvas
                ref={canvasRef}
                imageBase64={fullImageBase64}
                imageWidth={image.original_width}
                imageHeight={image.original_height}
                tool={tool}
                brushSize={brushSize}
                brushColor={brushColor}
                brushOpacity={brushOpacity}
                onMaskChange={handleMaskChange}
                initialMask={initialMaskData}
              />
            ) : null}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mr-auto">
            <span>B: 画笔</span>
            <span>E: 橡皮擦</span>
            <span>[/]: 大小</span>
            <span>滚轮: 缩放</span>
            <span>中键: 平移</span>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存蒙版</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
