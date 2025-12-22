import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ImageDropZone } from "../Generation/ImageDropZone";
import { useImageGeneration, useSettings } from "../../hooks";
import { ASPECT_RATIO_OPTIONS } from "../../types";
import type { ReferenceImage, GenerateImageRequest } from "../../types";
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Images,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";

type GenerationMode = "image" | "video";

interface OptionsPanelProps {
  projectId: string;
  onStartImageTask: (request: GenerateImageRequest) => Promise<string>;
  hasRunningTasks?: boolean;
}

export function OptionsPanel({ projectId, onStartImageTask, hasRunningTasks = false }: OptionsPanelProps) {
  const { readImageFile } = useImageGeneration();
  const { config, loadSettings } = useSettings();

  const [isOpen, setIsOpen] = useState(true);
  const [mode, setMode] = useState<GenerationMode>("image");

  // Image generation state
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [watermark, setWatermark] = useState(false);
  const [sequentialGeneration, setSequentialGeneration] = useState(false);
  const [sequentialCount, setSequentialCount] = useState<string>("auto"); // "auto" or "2"-"15"
  const [optimizePrompt, setOptimizePrompt] = useState(false);
  const [optimizePromptMode, setOptimizePromptMode] = useState<"standard" | "fast">("standard");

  // Sequential generation count options
  const sequentialCountOptions = [
    { value: "auto", label: "Auto" },
    ...Array.from({ length: 14 }, (_, i) => ({
      value: String(i + 2),
      label: String(i + 2),
    })),
  ];

  useEffect(() => {
    loadSettings().then((cfg) => {
      if (cfg) {
        setAspectRatio(cfg.default_aspect_ratio);
        setWatermark(cfg.watermark);
      }
    });
  }, [loadSettings]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    if (!config?.api_token_set || !config?.base_url || !config?.image_model) {
      toast.error("Please configure API settings first");
      return;
    }

    if (mode === "image") {
      // Get pixel dimensions from aspect ratio selection
      const selectedAspectRatio = ASPECT_RATIO_OPTIONS.find(opt => opt.value === aspectRatio);
      const pixelSize = selectedAspectRatio?.dimensions || "2048x2048";

      // Build the final prompt
      let finalPrompt = prompt.trim();
      const isAutoCount = sequentialCount === "auto";
      const specificCount = isAutoCount ? undefined : parseInt(sequentialCount);

      // If sequential with specific count, prepend instruction to prompt
      if (sequentialGeneration && specificCount) {
        finalPrompt = `Generate exactly ${specificCount} different images: ${finalPrompt}`;
      }

      // Start a new image generation task
      const request: GenerateImageRequest = {
        project_id: projectId,
        prompt: finalPrompt,
        reference_images: referenceImages.map((img) => img.base64),
        size: pixelSize,
        aspect_ratio: aspectRatio,
        watermark,
        sequential_generation: sequentialGeneration,
        max_images: sequentialGeneration ? (specificCount || 15) : undefined,
        optimize_prompt: optimizePrompt,
        optimize_prompt_mode: optimizePrompt ? optimizePromptMode : undefined,
      };

      await onStartImageTask(request);
      toast.info("Generation started");
    } else {
      toast.info("Video generation coming soon");
    }
  };

  const handleReadImage = useCallback(
    async (path: string) => {
      const result = await readImageFile(path);
      return {
        base64: result.base64,
        width: result.width,
        height: result.height,
        was_resized: result.was_resized,
        original_width: result.original_width,
        original_height: result.original_height,
      };
    },
    [readImageFile]
  );

  return (
    <div className="border-t bg-background">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Collapse Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-accent/50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Generation Options</span>
              {referenceImages.length > 0 && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  {referenceImages.length} reference{referenceImages.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {/* Mode Toggle */}
            <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
              <button
                onClick={() => setMode("image")}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  mode === "image"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ImageIcon className="w-4 h-4" />
                Image
              </button>
              <button
                onClick={() => setMode("video")}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  mode === "video"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Video className="w-4 h-4" />
                Video
              </button>
            </div>

            {/* Main Options Row */}
            <div className="flex gap-4">
              {/* Prompt */}
              <div className="flex-1 space-y-2">
                <Label htmlFor="prompt">Prompt</Label>
                <Textarea
                  id="prompt"
                  placeholder="Describe the image you want to generate..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Reference Images */}
              <div className="w-64">
                <ImageDropZone
                  images={referenceImages}
                  onImagesChange={setReferenceImages}
                  onReadImage={handleReadImage}
                  maxImages={14}
                />
              </div>
            </div>

            {/* Options Row */}
            <div className="flex items-end gap-4 flex-wrap">
              {/* Aspect Ratio */}
              <div className="space-y-1.5">
                <Label className="text-xs">Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger className="w-28 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Watermark */}
              <div className="flex items-center gap-2 h-8">
                <Switch
                  id="watermark"
                  checked={watermark}
                  onCheckedChange={setWatermark}
                />
                <Label htmlFor="watermark" className="text-xs">Watermark</Label>
              </div>

              {/* Sequential */}
              <div className="flex items-center gap-2 h-8">
                <Switch
                  id="sequential"
                  checked={sequentialGeneration}
                  onCheckedChange={setSequentialGeneration}
                />
                <Label htmlFor="sequential" className="text-xs flex items-center gap-1">
                  <Images className="w-3 h-3" />
                  Sequential
                </Label>
                {sequentialGeneration && (
                  <Select value={sequentialCount} onValueChange={setSequentialCount}>
                    <SelectTrigger className="w-20 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sequentialCountOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Optimize Prompt */}
              <div className="flex items-center gap-2 h-8">
                <Switch
                  id="optimize"
                  checked={optimizePrompt}
                  onCheckedChange={setOptimizePrompt}
                />
                <Label htmlFor="optimize" className="text-xs flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Optimize
                </Label>
                {optimizePrompt && (
                  <Select
                    value={optimizePromptMode}
                    onValueChange={(v) => setOptimizePromptMode(v as "standard" | "fast")}
                  >
                    <SelectTrigger className="w-24 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Generate Button */}
              <div className="ml-auto flex items-center gap-2">
                {hasRunningTasks && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Tasks running
                  </span>
                )}
                <Button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || !config?.api_token_set}
                  size="lg"
                  className="px-8"
                >
                  Generate
                </Button>
              </div>
            </div>

            {/* Hints */}
            {sequentialGeneration && sequentialCount === "auto" && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Tip:</span> In Auto mode, include the desired count in your prompt (e.g., "Generate 3 images of...") for best results.
              </p>
            )}

            {!config?.api_token_set && (
              <p className="text-xs text-yellow-500">
                Please configure API settings first
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
