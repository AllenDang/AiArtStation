import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Paintbrush,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PainterTool } from "../../types";

const PRESET_COLORS = [
  { name: "红色", value: "#FF0000" },
  { name: "绿色", value: "#00FF00" },
  { name: "蓝色", value: "#0066FF" },
  { name: "黄色", value: "#FFFF00" },
  { name: "白色", value: "#FFFFFF" },
];

interface PainterToolbarProps {
  tool: PainterTool;
  onToolChange: (tool: PainterTool) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  brushColor: string;
  onBrushColorChange: (color: string) => void;
  brushOpacity: number;
  onBrushOpacityChange: (opacity: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function PainterToolbar({
  tool,
  onToolChange,
  brushSize,
  onBrushSizeChange,
  brushColor,
  onBrushColorChange,
  brushOpacity,
  onBrushOpacityChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: PainterToolbarProps) {
  return (
    <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg flex-wrap">
      {/* Tools */}
      <div className="flex items-center gap-1">
        <Button
          variant={tool === "brush" ? "default" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onToolChange("brush")}
          title="画笔 (B)"
        >
          <Paintbrush className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "eraser" ? "default" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onToolChange("eraser")}
          title="橡皮擦 (E)"
        >
          <Eraser className="h-4 w-4" />
        </Button>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Brush Size */}
      <div className="flex items-center gap-2">
        <Label className="text-xs whitespace-nowrap">大小</Label>
        <input
          type="range"
          min="1"
          max="200"
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          className="w-24 h-1.5 bg-secondary rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <span className="text-xs text-muted-foreground w-8">{brushSize}px</span>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Opacity */}
      <div className="flex items-center gap-2">
        <Label className="text-xs whitespace-nowrap">不透明度</Label>
        <input
          type="range"
          min="10"
          max="100"
          value={brushOpacity}
          onChange={(e) => onBrushOpacityChange(Number(e.target.value))}
          className="w-20 h-1.5 bg-secondary rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <span className="text-xs text-muted-foreground w-8">{brushOpacity}%</span>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Color Picker */}
      <div className="flex items-center gap-2">
        <Label className="text-xs whitespace-nowrap">颜色</Label>
        <div className="flex items-center gap-1">
          {PRESET_COLORS.map((color) => (
            <button
              key={color.value}
              className={cn(
                "w-5 h-5 rounded-full border-2 transition-all",
                brushColor === color.value
                  ? "border-primary scale-110"
                  : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: color.value }}
              onClick={() => onBrushColorChange(color.value)}
              title={color.name}
            />
          ))}
          <input
            type="color"
            value={brushColor}
            onChange={(e) => onBrushColorChange(e.target.value)}
            className="w-5 h-5 rounded cursor-pointer border-0 p-0"
            title="自定义颜色"
          />
        </div>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onZoomOut}
          title="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground w-12 text-center"
          onClick={onZoomReset}
          title="重置缩放"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onZoomIn}
          title="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1" />

      {/* Clear */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onClear}
        title="清除蒙版"
      >
        <Trash2 className="h-4 w-4 mr-1" />
        清除
      </Button>
    </div>
  );
}
