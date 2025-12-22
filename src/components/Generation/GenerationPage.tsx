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
import { Card, CardContent } from "@/components/ui/card";
import { ImageDropZone } from "./ImageDropZone";
import { useImageGeneration, useSettings, useFiles } from "../../hooks";
import { SIZE_OPTIONS, ASPECT_RATIO_OPTIONS } from "../../types";
import type { ReferenceImage, GeneratedImageInfo } from "../../types";
import { Loader2, FolderOpen, ImagePlus, GripVertical, Sparkles, Images } from "lucide-react";
import { Input } from "@/components/ui/input";

interface GenerationPageProps {
  projectId: string;
}

export function GenerationPage({ projectId }: GenerationPageProps) {
  const { generating, result, error, generateImage, readImageFile } =
    useImageGeneration();
  const { config, loadSettings } = useSettings();
  const { openFile, openFolder } = useFiles();

  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [size, setSize] = useState("2K");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [watermark, setWatermark] = useState(false);
  // Batch generation
  const [sequentialGeneration, setSequentialGeneration] = useState(false);
  const [maxImages, setMaxImages] = useState(3);
  // Prompt optimization
  const [optimizePrompt, setOptimizePrompt] = useState(false);
  const [optimizePromptMode, setOptimizePromptMode] = useState<"standard" | "fast">("standard");
  const [generatedImages, setGeneratedImages] = useState<GeneratedImageInfo[]>(
    []
  );

  useEffect(() => {
    loadSettings().then((cfg) => {
      if (cfg) {
        setSize(cfg.default_size);
        setAspectRatio(cfg.default_aspect_ratio);
        setWatermark(cfg.watermark);
      }
    });
  }, [loadSettings]);

  useEffect(() => {
    if (result) {
      setGeneratedImages(result.images);
      toast.success(
        `Generated ${result.images.length} image(s). Tokens used: ${result.tokens_used}`
      );
    }
  }, [result]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    if (!config?.api_token_set || !config?.base_url || !config?.image_model) {
      toast.error("Please configure API settings first");
      return;
    }

    try {
      await generateImage({
        project_id: projectId,
        prompt: prompt.trim(),
        reference_images: referenceImages.map((img) => img.base64),
        size,
        aspect_ratio: aspectRatio,
        watermark,
        sequential_generation: sequentialGeneration,
        max_images: sequentialGeneration ? maxImages : undefined,
        optimize_prompt: optimizePrompt,
        optimize_prompt_mode: optimizePrompt ? optimizePromptMode : undefined,
      });
    } catch {
      // Error is handled by useEffect
    }
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent, image: GeneratedImageInfo) => {
      const data = JSON.stringify({
        base64: image.base64_preview,
        file_path: image.file_path,
        width: parseInt(image.size.split("x")[0]) || 0,
        height: parseInt(image.size.split("x")[1]) || 0,
      });
      e.dataTransfer.setData("application/x-ai-artstation-image", data);
      e.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  const handleUseAsReference = useCallback(
    (image: GeneratedImageInfo) => {
      if (referenceImages.length >= 14) {
        toast.error("Maximum 14 reference images");
        return;
      }

      const newRef: ReferenceImage = {
        id: crypto.randomUUID(),
        base64: image.base64_preview,
        width: parseInt(image.size.split("x")[0]) || 0,
        height: parseInt(image.size.split("x")[1]) || 0,
        was_resized: false,
        original_width: parseInt(image.size.split("x")[0]) || 0,
        original_height: parseInt(image.size.split("x")[1]) || 0,
        file_path: image.file_path,
      };
      setReferenceImages([...referenceImages, newRef]);
      toast.info("Added to references");
    },
    [referenceImages]
  );

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
    <div className="flex h-full">
      {/* Main Result Area */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="h-full flex flex-col">
          {generatedImages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <ImagePlus className="mx-auto h-16 w-16 mb-4 stroke-1" />
                <p className="text-lg font-medium">
                  Enter a prompt and click Generate
                </p>
                <p className="text-sm mt-2">Generated images will appear here</p>
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Generated Images</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    config?.output_directory &&
                    openFolder(config.output_directory)
                  }
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Open Folder
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {generatedImages.map((image) => (
                  <Card
                    key={image.id}
                    className="group overflow-hidden cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => handleDragStart(e, image)}
                  >
                    <CardContent className="p-0 relative">
                      <img
                        src={image.base64_preview}
                        alt="Generated"
                        className="w-full"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-xs text-muted-foreground mb-2">
                          {image.size}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleUseAsReference(image)}
                          >
                            Use as Reference
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openFile(image.file_path)}
                          >
                            Open
                          </Button>
                        </div>
                      </div>
                      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                        <GripVertical className="w-3 h-3" />
                        Drag to Reference
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Controls */}
      <div className="w-80 border-l p-4 overflow-auto">
        <div className="space-y-6">
          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              placeholder="Describe the image you want to generate..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Use descriptive keywords for best results
            </p>
          </div>

          {/* Reference Images */}
          <ImageDropZone
            images={referenceImages}
            onImagesChange={setReferenceImages}
            onReadImage={handleReadImage}
          />

          {/* Options */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger>
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

            <div className="flex items-center justify-between">
              <Label htmlFor="watermark">Watermark</Label>
              <Switch
                id="watermark"
                checked={watermark}
                onCheckedChange={setWatermark}
              />
            </div>

            {/* Sequential Image Generation (组图) */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Images className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="sequential">Sequential Images</Label>
                </div>
                <Switch
                  id="sequential"
                  checked={sequentialGeneration}
                  onCheckedChange={setSequentialGeneration}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Generate a series of related images
              </p>
              {sequentialGeneration && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs text-muted-foreground">
                    Max Images (1-15)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={15}
                    value={maxImages}
                    onChange={(e) =>
                      setMaxImages(Math.min(15, Math.max(1, parseInt(e.target.value) || 1)))
                    }
                    className="h-8"
                  />
                </div>
              )}
            </div>

            {/* Prompt Optimization */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="optimize">Optimize Prompt</Label>
                </div>
                <Switch
                  id="optimize"
                  checked={optimizePrompt}
                  onCheckedChange={setOptimizePrompt}
                />
              </div>
              {optimizePrompt && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs text-muted-foreground">Mode</Label>
                  <Select
                    value={optimizePromptMode}
                    onValueChange={(v) => setOptimizePromptMode(v as "standard" | "fast")}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (Higher Quality)</SelectItem>
                      <SelectItem value="fast">Fast (Quicker)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || !config?.api_token_set}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate"
            )}
          </Button>

          {!config?.api_token_set && (
            <p className="text-xs text-yellow-500 text-center">
              Please configure API settings first
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
