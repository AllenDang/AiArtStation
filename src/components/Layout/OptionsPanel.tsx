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
import type { ReferenceImage, GenerateImageRequestWithPaths, GenerateVideoRequestWithPaths, VideoGenerationType } from "../../types";
import {
  ChevronUp,
  ChevronDown,
  Sparkles,
  Images,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";

type GenerationMode = "image" | "video";

// Video aspect ratio options
const VIDEO_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "1:1", label: "1:1 方形" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 超宽" },
];

// Video resolution options
const VIDEO_RESOLUTION_OPTIONS = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

// Video duration options (2-12 seconds)
const VIDEO_DURATION_OPTIONS = Array.from({ length: 11 }, (_, i) => ({
  value: String(i + 2),
  label: `${i + 2}秒`,
}));

// Video generation type options
const VIDEO_GENERATION_TYPE_OPTIONS: { value: VideoGenerationType; label: string; description: string }[] = [
  { value: "text-to-video", label: "文生视频", description: "纯文字描述生成视频" },
  { value: "image-to-video-first", label: "首帧生成", description: "基于首帧图片生成视频" },
  { value: "image-to-video-both", label: "首尾帧生成", description: "基于首尾帧生成过渡视频" },
  { value: "image-to-video-ref", label: "参考图生成", description: "基于参考图片风格生成" },
];

interface OptionsPanelProps {
  projectId: string;
  onStartImageTask: (request: GenerateImageRequestWithPaths) => string;
  onStartVideoTask?: (request: GenerateVideoRequestWithPaths) => void;
}

export function OptionsPanel({ projectId, onStartImageTask, onStartVideoTask }: OptionsPanelProps) {
  const { readImageFile } = useImageGeneration(); // Still needed for ImageDropZone
  const { config, loadSettings } = useSettings();

  const [isOpen, setIsOpen] = useState(true);
  const [mode, setMode] = useState<GenerationMode>("image");

  // Image generation state
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [sequentialGeneration, setSequentialGeneration] = useState(false);
  const [sequentialCount, setSequentialCount] = useState<string>("auto");
  const [optimizePrompt, setOptimizePrompt] = useState(false);
  const [optimizePromptMode, setOptimizePromptMode] = useState<"standard" | "fast">("standard");

  // Video generation state
  const [videoGenerationType, setVideoGenerationType] = useState<VideoGenerationType>("text-to-video");
  const [videoFirstFrame, setVideoFirstFrame] = useState<ReferenceImage | null>(null);
  const [videoLastFrame, setVideoLastFrame] = useState<ReferenceImage | null>(null);
  const [videoRefImages, setVideoRefImages] = useState<ReferenceImage[]>([]);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoDuration, setVideoDuration] = useState("5");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");

  // Sequential generation count options
  const sequentialCountOptions = [
    { value: "auto", label: "自动" },
    ...Array.from({ length: 14 }, (_, i) => ({
      value: String(i + 2),
      label: String(i + 2),
    })),
  ];

  useEffect(() => {
    loadSettings().then((cfg) => {
      if (cfg) {
        setAspectRatio(cfg.default_aspect_ratio);
      }
    });
  }, [loadSettings]);

  // Convert ReferenceImage to ReferenceImageInput for hooks
  const toImageInput = (img: ReferenceImage | null) => {
    if (!img) return undefined;
    return { base64: img.base64, file_path: img.file_path };
  };

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error("请输入提示词");
      return;
    }

    if (mode === "image") {
      if (!config?.api_token_set || !config?.base_url || !config?.image_model) {
        toast.error("请先配置API设置");
        return;
      }

      const selectedAspectRatio = ASPECT_RATIO_OPTIONS.find(opt => opt.value === aspectRatio);
      const pixelSize = selectedAspectRatio?.dimensions || "2048x2048";

      let finalPrompt = prompt.trim();
      const isAutoCount = sequentialCount === "auto";
      const specificCount = isAutoCount ? undefined : parseInt(sequentialCount);

      if (sequentialGeneration && specificCount) {
        finalPrompt = `Generate exactly ${specificCount} different images: ${finalPrompt}`;
      }

      // Pass file paths - hooks will read files in background
      const request: GenerateImageRequestWithPaths = {
        project_id: projectId,
        prompt: finalPrompt,
        reference_image_inputs: referenceImages.map(img => ({
          base64: img.base64,
          file_path: img.file_path,
        })),
        size: pixelSize,
        aspect_ratio: aspectRatio,
        watermark: false,
        sequential_generation: sequentialGeneration,
        max_images: sequentialGeneration ? (specificCount || 15) : undefined,
        optimize_prompt: optimizePrompt,
        optimize_prompt_mode: optimizePrompt ? optimizePromptMode : undefined,
      };

      onStartImageTask(request); // No await - returns immediately, task appears instantly
      toast.info("开始生成图片");
    } else {
      // Video generation
      if (!config?.api_token_set || !config?.base_url || !config?.video_model) {
        toast.error("请先配置视频模型");
        return;
      }

      if (!onStartVideoTask) {
        toast.error("视频生成功能未启用");
        return;
      }

      // Validate based on generation type
      if (videoGenerationType === "image-to-video-first" && !videoFirstFrame) {
        toast.error("请上传首帧图片");
        return;
      }
      if (videoGenerationType === "image-to-video-both" && (!videoFirstFrame || !videoLastFrame)) {
        toast.error("请上传首帧和尾帧图片");
        return;
      }
      if (videoGenerationType === "image-to-video-ref" && videoRefImages.length === 0) {
        toast.error("请上传至少一张参考图片");
        return;
      }

      // Pass file paths - hooks will read files in background
      const request: GenerateVideoRequestWithPaths = {
        project_id: projectId,
        prompt: prompt.trim(),
        generation_type: videoGenerationType,
        first_frame_input: toImageInput(videoFirstFrame),
        last_frame_input: toImageInput(videoLastFrame),
        reference_image_inputs: videoRefImages.map(img => ({
          base64: img.base64,
          file_path: img.file_path,
        })),
        resolution: videoResolution,
        duration: parseInt(videoDuration),
        aspect_ratio: videoAspectRatio,
      };

      onStartVideoTask(request); // No await - returns immediately, task appears instantly
      toast.info("开始生成视频");
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

  // Handle single image for video frames
  const handleVideoFrameChange = useCallback(
    (setter: (img: ReferenceImage | null) => void) => (images: ReferenceImage[]) => {
      setter(images.length > 0 ? images[0] : null);
    },
    []
  );

  const isVideoModelConfigured = config?.video_model && config.video_model.length > 0;

  return (
    <div className="border-t bg-background">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Collapse Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-accent/50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">生成选项</span>
              {mode === "image" && referenceImages.length > 0 && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  {referenceImages.length} 个参考图
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
          <div className="px-4 pb-4 flex flex-col gap-4">
            {/* Mode Toggle */}
            <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit flex-shrink-0">
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
                图片
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
                视频
              </button>
            </div>

            {mode === "image" ? (
              <>
                {/* Image Mode UI */}
                <div className="flex gap-4 items-stretch">
                  <div className="flex-1 flex flex-col gap-2">
                    <Label htmlFor="prompt" className="flex-shrink-0">提示词</Label>
                    <Textarea
                      id="prompt"
                      placeholder="描述你想要生成的图片..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="resize-none flex-1 min-h-[100px]"
                    />
                  </div>
                  <div className="w-64 flex-shrink-0">
                    <ImageDropZone
                      images={referenceImages}
                      onImagesChange={setReferenceImages}
                      onReadImage={handleReadImage}
                      maxImages={14}
                    />
                  </div>
                </div>

                <div className="flex items-end gap-4 flex-wrap">
                  <div className="space-y-1.5">
                    <Label className="text-xs">宽高比</Label>
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

                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="sequential"
                      checked={sequentialGeneration}
                      onCheckedChange={setSequentialGeneration}
                    />
                    <Label htmlFor="sequential" className="text-xs flex items-center gap-1">
                      <Images className="w-3 h-3" />
                      生成组图
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

                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="optimize"
                      checked={optimizePrompt}
                      onCheckedChange={setOptimizePrompt}
                    />
                    <Label htmlFor="optimize" className="text-xs flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      优化提示词
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
                          <SelectItem value="standard">标准</SelectItem>
                          <SelectItem value="fast">快速</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="ml-auto">
                    <Button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || !config?.api_token_set}
                      size="lg"
                      className="px-8"
                    >
                      生成
                    </Button>
                  </div>
                </div>

                {sequentialGeneration && sequentialCount === "auto" && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">提示：</span>在自动模式下，请在提示词中包含所需数量（例如"生成3张..."）以获得最佳效果。
                  </p>
                )}
              </>
            ) : (
              <>
                {/* Video Mode UI - same layout as image generation, consistent height across all types */}
                <div className="flex gap-4 items-stretch h-[168px]">
                  <div className="flex-1 flex flex-col gap-2">
                    <Label htmlFor="video-prompt" className="flex-shrink-0">提示词</Label>
                    <Textarea
                      id="video-prompt"
                      placeholder="描述你想要生成的视频内容..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="resize-none flex-1"
                    />
                  </div>
                  {/* Reference images - hide for text-to-video so prompt takes full width */}
                  {videoGenerationType !== "text-to-video" && (
                    <div className="w-64 flex-shrink-0 h-full">
                      {videoGenerationType === "image-to-video-first" && (
                        <div className="h-full">
                          <ImageDropZone
                            images={videoFirstFrame ? [videoFirstFrame] : []}
                            onImagesChange={handleVideoFrameChange(setVideoFirstFrame)}
                            onReadImage={handleReadImage}
                            maxImages={1}
                            label="首帧图片"
                            singleImageFill
                          />
                        </div>
                      )}
                      {videoGenerationType === "image-to-video-both" && (
                        <div className="flex gap-2 h-full">
                          <div className="flex-1 h-full">
                            <ImageDropZone
                              images={videoFirstFrame ? [videoFirstFrame] : []}
                              onImagesChange={handleVideoFrameChange(setVideoFirstFrame)}
                              onReadImage={handleReadImage}
                              maxImages={1}
                              label="首帧"
                              singleImageFill
                            />
                          </div>
                          <div className="flex-1 h-full">
                            <ImageDropZone
                              images={videoLastFrame ? [videoLastFrame] : []}
                              onImagesChange={handleVideoFrameChange(setVideoLastFrame)}
                              onReadImage={handleReadImage}
                              maxImages={1}
                              label="尾帧"
                              singleImageFill
                            />
                          </div>
                        </div>
                      )}
                      {videoGenerationType === "image-to-video-ref" && (
                        <ImageDropZone
                          images={videoRefImages}
                          onImagesChange={setVideoRefImages}
                          onReadImage={handleReadImage}
                          maxImages={4}
                          label={`参考图片 (${videoRefImages.length}/4)`}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Video Options Row */}
                <div className="flex items-end gap-4 flex-wrap">
                  <div className="space-y-1.5">
                    <Label className="text-xs">生成类型</Label>
                    <Select value={videoGenerationType} onValueChange={(v) => setVideoGenerationType(v as VideoGenerationType)}>
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_GENERATION_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">宽高比</Label>
                    <Select value={videoAspectRatio} onValueChange={setVideoAspectRatio}>
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_ASPECT_RATIO_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">分辨率</Label>
                    <Select value={videoResolution} onValueChange={setVideoResolution}>
                      <SelectTrigger className="w-24 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_RESOLUTION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">时长</Label>
                    <Select value={videoDuration} onValueChange={setVideoDuration}>
                      <SelectTrigger className="w-20 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ml-auto">
                    <Button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || !config?.api_token_set || !isVideoModelConfigured}
                      size="lg"
                      className="px-8"
                    >
                      生成视频
                    </Button>
                  </div>
                </div>

                {!isVideoModelConfigured && (
                  <p className="text-xs text-yellow-500">
                    请先在设置中配置视频模型
                  </p>
                )}
              </>
            )}

            {!config?.api_token_set && (
              <p className="text-xs text-yellow-500">
                请先配置API设置
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
