import { useState, useCallback, useRef } from "react";

const MAX_HISTORY = 50;

export interface PainterState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => ImageData | null;
  redo: () => ImageData | null;
  pushState: (imageData: ImageData) => void;
  clear: () => void;
}

export function usePainterState(): PainterState {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<ImageData[]>([]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  const pushState = useCallback((imageData: ImageData) => {
    // Clone the ImageData to avoid mutation issues
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(imageData, 0, 0);
    const clonedData = ctx.getImageData(0, 0, imageData.width, imageData.height);

    // If we're not at the end of history, truncate future states
    if (historyIndex < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndex + 1);
    }

    // Add new state
    historyRef.current.push(clonedData);

    // Trim history if it exceeds max
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      setHistoryIndex(historyRef.current.length - 1);
    }
  }, [historyIndex]);

  const undo = useCallback((): ImageData | null => {
    if (!canUndo) return null;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    return historyRef.current[newIndex];
  }, [canUndo, historyIndex]);

  const redo = useCallback((): ImageData | null => {
    if (!canRedo) return null;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    return historyRef.current[newIndex];
  }, [canRedo, historyIndex]);

  const clear = useCallback(() => {
    historyRef.current = [];
    setHistoryIndex(-1);
  }, []);

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    pushState,
    clear,
  };
}
