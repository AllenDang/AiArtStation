import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import type { PainterTool } from "../../types";

interface PainterCanvasProps {
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  tool: PainterTool;
  brushSize: number;
  brushColor: string;
  brushOpacity: number;
  onMaskChange: (maskData: ImageData) => void;
  initialMask?: ImageData | null;
}

export interface PainterCanvasHandle {
  getMaskData: () => ImageData | null;
  setMaskData: (data: ImageData) => void;
  clearMask: () => void;
  getZoom: () => number;
}

export const PainterCanvas = forwardRef<PainterCanvasHandle, PainterCanvasProps>(
  function PainterCanvas(
    {
      imageBase64,
      imageWidth,
      imageHeight,
      tool,
      brushSize,
      brushColor,
      brushOpacity,
      onMaskChange,
      initialMask,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);

    // Transform state
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    // Interaction state
    const [isPanning, setIsPanning] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const lastPosRef = useRef({ x: 0, y: 0 });
    const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

    // Load image and initialize canvases
    useEffect(() => {
      const imageCanvas = imageCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!imageCanvas || !maskCanvas) return;

      imageCanvas.width = imageWidth;
      imageCanvas.height = imageHeight;
      maskCanvas.width = imageWidth;
      maskCanvas.height = imageHeight;

      // Draw image
      const imageCtx = imageCanvas.getContext("2d")!;
      const img = new Image();
      img.onload = () => {
        imageCtx.drawImage(img, 0, 0);
      };
      img.src = imageBase64;

      // Initialize mask canvas with transparent background
      const maskCtx = maskCanvas.getContext("2d")!;
      maskCtx.clearRect(0, 0, imageWidth, imageHeight);

      // Apply initial mask if provided
      if (initialMask) {
        maskCtx.putImageData(initialMask, 0, 0);
      }

      // Calculate initial zoom to fit
      const container = containerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const scaleX = (containerRect.width - 40) / imageWidth;
        const scaleY = (containerRect.height - 40) / imageHeight;
        const fitZoom = Math.min(scaleX, scaleY, 1);
        setZoom(fitZoom);
        // Center the image
        setOffset({
          x: (containerRect.width - imageWidth * fitZoom) / 2,
          y: (containerRect.height - imageHeight * fitZoom) / 2,
        });
      }
    }, [imageBase64, imageWidth, imageHeight, initialMask]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      getMaskData: () => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return null;
        const ctx = maskCanvas.getContext("2d")!;
        return ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      },
      setMaskData: (data: ImageData) => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return;
        const ctx = maskCanvas.getContext("2d")!;
        ctx.putImageData(data, 0, 0);
      },
      clearMask: () => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return;
        const ctx = maskCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      },
      getZoom: () => zoom,
    }));

    // Convert screen coordinates to canvas coordinates
    const screenToCanvas = useCallback(
      (screenX: number, screenY: number) => {
        const container = containerRef.current;
        if (!container) return { x: 0, y: 0 };
        const rect = container.getBoundingClientRect();
        return {
          x: (screenX - rect.left - offset.x) / zoom,
          y: (screenY - rect.top - offset.y) / zoom,
        };
      },
      [zoom, offset]
    );

    // Draw a brush stroke
    const drawStroke = useCallback(
      (x1: number, y1: number, x2: number, y2: number) => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return;

        const ctx = maskCanvas.getContext("2d")!;

        if (tool === "eraser") {
          ctx.globalCompositeOperation = "destination-out";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
          ctx.globalCompositeOperation = "source-over";
          // Parse color and apply opacity
          const hex = brushColor.replace("#", "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          ctx.strokeStyle = `rgba(${r},${g},${b},${brushOpacity / 100})`;
        }

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = brushSize;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      },
      [tool, brushSize, brushColor, brushOpacity]
    );

    // Handle mouse wheel for zoom
    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom change
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));

        // Adjust offset to zoom toward cursor position
        const scaleChange = newZoom / zoom;
        const newOffsetX = mouseX - (mouseX - offset.x) * scaleChange;
        const newOffsetY = mouseY - (mouseY - offset.y) * scaleChange;

        setZoom(newZoom);
        setOffset({ x: newOffsetX, y: newOffsetY });
      },
      [zoom, offset]
    );

    // Handle mouse down
    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();

        // Middle mouse button for panning
        if (e.button === 1) {
          setIsPanning(true);
          panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
          };
          return;
        }

        // Left mouse button for drawing
        if (e.button === 0) {
          setIsDrawing(true);
          const pos = screenToCanvas(e.clientX, e.clientY);
          lastPosRef.current = pos;

          // Draw a dot at the starting point
          drawStroke(pos.x, pos.y, pos.x, pos.y);
        }
      },
      [offset, screenToCanvas, drawStroke]
    );

    // Handle mouse move
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (isPanning) {
          const dx = e.clientX - panStartRef.current.x;
          const dy = e.clientY - panStartRef.current.y;
          setOffset({
            x: panStartRef.current.offsetX + dx,
            y: panStartRef.current.offsetY + dy,
          });
          return;
        }

        if (isDrawing) {
          const pos = screenToCanvas(e.clientX, e.clientY);
          drawStroke(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y);
          lastPosRef.current = pos;
        }
      },
      [isPanning, isDrawing, screenToCanvas, drawStroke]
    );

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
      if (isDrawing) {
        // Save mask state for undo
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
          const ctx = maskCanvas.getContext("2d")!;
          const maskData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          onMaskChange(maskData);
        }
      }
      setIsPanning(false);
      setIsDrawing(false);
    }, [isDrawing, onMaskChange]);

    // Handle mouse leave
    const handleMouseLeave = useCallback(() => {
      if (isDrawing) {
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
          const ctx = maskCanvas.getContext("2d")!;
          const maskData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          onMaskChange(maskData);
        }
      }
      setIsPanning(false);
      setIsDrawing(false);
    }, [isDrawing, onMaskChange]);

    // Prevent context menu on right click
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
    }, []);

    // Get cursor style
    const getCursor = () => {
      if (isPanning) return "grabbing";
      return "crosshair";
    };

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden bg-neutral-900 rounded-lg"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        style={{ cursor: getCursor() }}
      >
        {/* Checkered background for transparency */}
        <div
          className="absolute"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: imageWidth,
            height: imageHeight,
            backgroundImage: `
              linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
              linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
              linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
            `,
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
          }}
        />

        {/* Image canvas (background) */}
        <canvas
          ref={imageCanvasRef}
          className="absolute pointer-events-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        />

        {/* Mask canvas (foreground, semi-transparent overlay) */}
        <canvas
          ref={maskCanvasRef}
          className="absolute pointer-events-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            opacity: 0.6,
          }}
        />

        {/* Zoom indicator */}
        <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded">
          {Math.round(zoom * 100)}%
        </div>
      </div>
    );
  }
);
