import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
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
import { Input } from "@/components/ui/input";
import { ImageDropZone } from "../Generation/ImageDropZone";
import { MediaDropZone } from "../Generation/MediaDropZone";
import type { MediaFile } from "../Generation/MediaDropZone";
import { PainterDialog } from "../Painter";
import { useImageGeneration, useSettings, useGallery } from "../../hooks";
import { ASPECT_RATIO_OPTIONS } from "../../types";
import type { ReferenceImage, GenerateImageRequestWithPaths, GenerateVideoRequestWithPaths, VideoGenerationType, OptionsPanelHandle, MaskData } from "../../types";
import {
  ChevronUp,
  ChevronDown,
  Sparkles,
  Images,
  Image as ImageIcon,
  Video,
  FileVideo,
  FileAudio,
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

// Video duration options (-1 = auto, 4-15 seconds for Seedance 2.0)
const VIDEO_DURATION_OPTIONS = [
  { value: "-1", label: "自动" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 4),
    label: `${i + 4}秒`,
  })),
];

// Video generation type options
const VIDEO_GENERATION_TYPE_OPTIONS: { value: VideoGenerationType; label: string; description: string }[] = [
  { value: "text-to-video", label: "文生视频", description: "纯文字描述生成视频" },
  { value: "image-to-video-first", label: "首帧生成", description: "基于首帧图片生成视频" },
  { value: "image-to-video-both", label: "首尾帧生成", description: "基于首尾帧生成过渡视频" },
  { value: "image-to-video-ref", label: "参考图生成", description: "基于参考图片风格生成" },
  { value: "multimodal-ref", label: "多模态参考", description: "参考图片+视频+音频生成" },
];

interface OptionsPanelProps {
  projectId: string;
  onStartImageTask: (request: GenerateImageRequestWithPaths) => string;
  onStartVideoTask?: (request: GenerateVideoRequestWithPaths) => void;
}

export const OptionsPanel = forwardRef<OptionsPanelHandle, OptionsPanelProps>(function OptionsPanel(
  { projectId, onStartImageTask, onStartVideoTask },
  ref
) {
  const { readImageFile } = useImageGeneration(); // Still needed for ImageDropZone
  const { config, loadSettings } = useSettings();
  const { readImageRaw } = useGallery(); // For reading full-res images in painter

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

  // Mask state for painter feature
  const [imageMasks, setImageMasks] = useState<Map<string, MaskData>>(new Map());
  const [painterImage, setPainterImage] = useState<ReferenceImage | null>(null);

  // Video generation state
  const [videoGenerationType, setVideoGenerationType] = useState<VideoGenerationType>("text-to-video");
  const [videoFirstFrame, setVideoFirstFrame] = useState<ReferenceImage | null>(null);
  const [videoLastFrame, setVideoLastFrame] = useState<ReferenceImage | null>(null);
  const [videoRefImages, setVideoRefImages] = useState<ReferenceImage[]>([]);
  const [videoRefVideos, setVideoRefVideos] = useState<MediaFile[]>([]);
  const [videoRefAudios, setVideoRefAudios] = useState<MediaFile[]>([]);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoDuration, setVideoDuration] = useState("5");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [returnLastFrame, setReturnLastFrame] = useState(false);
  const [videoSeed, setVideoSeed] = useState("-1");
  // Tab for multimodal-ref reference area
  const [multimodalTab, setMultimodalTab] = useState<"image" | "video" | "audio">("image");

  // Sequential generation count options
  const sequentialCountOptions = [
    { value: "auto", label: "自动" },
    ...Array.from({ length: 14 }, (_, i) => ({
      value: String(i + 2),
      label: String(i + 2),
    })),
  ];

  // Expose cleanup method for deleted files
  useImperativeHandle(ref, () => ({
    cleanupDeletedFile: (filePath: string) => {
      // Clean up image generation references and their masks
      setReferenceImages(prev => {
        const filtered = prev.filter(img => img.file_path !== filePath);
        // Also clean up masks for removed images
        const removedIds = prev.filter(img => img.file_path === filePath).map(img => img.id);
        if (removedIds.length > 0) {
          setImageMasks(prevMasks => {
            const newMasks = new Map(prevMasks);
            removedIds.forEach(id => newMasks.delete(id));
            return newMasks;
          });
        }
        return filtered;
      });
      // Clean up video first frame
      setVideoFirstFrame(prev => prev?.file_path === filePath ? null : prev);
      // Clean up video last frame
      setVideoLastFrame(prev => prev?.file_path === filePath ? null : prev);
      // Clean up video reference images
      setVideoRefImages(prev => prev.filter(img => img.file_path !== filePath));
      // Clean up video reference videos/audios
      setVideoRefVideos(prev => prev.filter(f => f.path !== filePath));
      setVideoRefAudios(prev => prev.filter(f => f.path !== filePath));
    }
  }), []);

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

  const handleGenerate = async () => {
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

      // Process reference images - pass mask data for background processing
      const processedInputs = referenceImages.map((img) => {
        const mask = imageMasks.get(img.id);
        return {
          base64: img.base64,
          file_path: img.file_path,
          mask_base64: mask?.mask_base64, // Mask will be combined in background task
        };
      });

      // Pass file paths - hooks will read files in background
      const request: GenerateImageRequestWithPaths = {
        project_id: projectId,
        prompt: finalPrompt,
        reference_image_inputs: processedInputs,
        size: pixelSize,
        aspect_ratio: aspectRatio,
        watermark: false,
        sequential_generation: sequentialGeneration,
        max_images: sequentialGeneration ? (specificCount || 15) : undefined,
        optimize_prompt: optimizePrompt,
        optimize_prompt_mode: optimizePrompt ? optimizePromptMode : undefined,
      };

      onStartImageTask(request); // No await - returns immediately, task appears instantly
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
      if (videoGenerationType === "multimodal-ref") {
        if (videoRefImages.length === 0 && videoRefVideos.length === 0) {
          toast.error("多模态参考至少需要一张图片或一个视频");
          return;
        }
        if (videoRefAudios.length > 0 && videoRefImages.length === 0 && videoRefVideos.length === 0) {
          toast.error("不可单独输入音频，应至少包含1个参考视频或图片");
          return;
        }
      }

      const parsedSeed = parseInt(videoSeed);

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
        reference_video_paths: videoRefVideos.map(v => v.path),
        reference_audio_paths: videoRefAudios.map(a => a.path),
        resolution: videoResolution,
        duration: parseInt(videoDuration),
        aspect_ratio: videoAspectRatio,
        generate_audio: generateAudio,
        return_last_frame: returnLastFrame,
        watermark: false,
        seed: isNaN(parsedSeed) ? -1 : parsedSeed,
      };

      onStartVideoTask(request); // No await - returns immediately, task appears instantly
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

  // Handle clicking on an image to open painter
  const handleImageClick = useCallback((image: ReferenceImage) => {
    setPainterImage(image);
  }, []);

  // Handle saving mask from painter
  const handleSaveMask = useCallback((maskData: MaskData) => {
    setImageMasks(prev => {
      const newMasks = new Map(prev);
      newMasks.set(maskData.image_id, maskData);
      return newMasks;
    });
  }, []);

  // Read full-resolution image for painter
  const handleReadFullImage = useCallback(async (path: string): Promise<string> => {
    return readImageRaw(path);
  }, [readImageRaw]);

  // Wrapper for setReferenceImages that cleans up masks for removed images
  const handleReferenceImagesChange = useCallback((newImages: ReferenceImage[]) => {
    setReferenceImages(prev => {
      // Find removed image IDs
      const newIds = new Set(newImages.map(img => img.id));
      const removedIds = prev.filter(img => !newIds.has(img.id)).map(img => img.id);

      // Clean up masks for removed images
      if (removedIds.length > 0) {
        setImageMasks(prevMasks => {
          const newMasks = new Map(prevMasks);
          removedIds.forEach(id => newMasks.delete(id));
          return newMasks;
        });
      }

      return newImages;
    });
  }, []);

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
                      onImagesChange={handleReferenceImagesChange}
                      onReadImage={handleReadImage}
                      maxImages={14}
                      dropZoneType="image-ref"
                      imageMasks={imageMasks}
                      onImageClick={handleImageClick}
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
                            dropZoneType="video-first"
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
                              dropZoneType="video-both-first"
                              onVideoFrameDrop={(_first, last) => {
                                // When video is dropped on first frame zone, also fill last frame
                                if (last) {
                                  setVideoLastFrame(last);
                                }
                              }}
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
                              dropZoneType="video-both-last"
                            />
                          </div>
                        </div>
                      )}
                      {videoGenerationType === "image-to-video-ref" && (
                        <ImageDropZone
                          images={videoRefImages}
                          onImagesChange={setVideoRefImages}
                          onReadImage={handleReadImage}
                          maxImages={9}
                          label={`参考图片 (${videoRefImages.length}/9)`}
                          dropZoneType="video-ref"
                        />
                      )}
                      {videoGenerationType === "multimodal-ref" && (
                        <div className="flex flex-col h-full gap-1">
                          {/* Tab switcher */}
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => setMultimodalTab("image")}
                              className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors",
                                multimodalTab === "image"
                                  ? "bg-primary/20 text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <ImageIcon className="w-3 h-3" />
                              图片{videoRefImages.length > 0 && ` (${videoRefImages.length})`}
                            </button>
                            <button
                              onClick={() => setMultimodalTab("video")}
                              className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors",
                                multimodalTab === "video"
                                  ? "bg-primary/20 text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <FileVideo className="w-3 h-3" />
                              视频{videoRefVideos.length > 0 && ` (${videoRefVideos.length})`}
                            </button>
                            <button
                              onClick={() => setMultimodalTab("audio")}
                              className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors",
                                multimodalTab === "audio"
                                  ? "bg-primary/20 text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <FileAudio className="w-3 h-3" />
                              音频{videoRefAudios.length > 0 && ` (${videoRefAudios.length})`}
                            </button>
                          </div>
                          {/* Tab content */}
                          <div className="flex-1 min-h-0">
                            {multimodalTab === "image" && (
                              <ImageDropZone
                                images={videoRefImages}
                                onImagesChange={setVideoRefImages}
                                onReadImage={handleReadImage}
                                maxImages={9}
                                label={`参考图片 (${videoRefImages.length}/9)`}
                                dropZoneType="video-ref"
                              />
                            )}
                            {multimodalTab === "video" && (
                              <MediaDropZone
                                files={videoRefVideos}
                                onFilesChange={setVideoRefVideos}
                                maxFiles={3}
                                extensions={["mp4", "mov"]}
                                label={`参考视频 (${videoRefVideos.length}/3)`}
                                mediaType="video"
                                maxSizeMB={50}
                              />
                            )}
                            {multimodalTab === "audio" && (
                              <MediaDropZone
                                files={videoRefAudios}
                                onFilesChange={setVideoRefAudios}
                                maxFiles={3}
                                extensions={["wav", "mp3"]}
                                label={`参考音频 (${videoRefAudios.length}/3)`}
                                mediaType="audio"
                                maxSizeMB={15}
                              />
                            )}
                          </div>
                        </div>
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

                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="generate-audio"
                      checked={generateAudio}
                      onCheckedChange={setGenerateAudio}
                    />
                    <Label htmlFor="generate-audio" className="text-xs">
                      生成音频
                    </Label>
                  </div>

                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="return-last-frame"
                      checked={returnLastFrame}
                      onCheckedChange={setReturnLastFrame}
                    />
                    <Label htmlFor="return-last-frame" className="text-xs">
                      返回尾帧
                    </Label>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">种子</Label>
                    <Input
                      type="number"
                      value={videoSeed}
                      onChange={(e) => setVideoSeed(e.target.value)}
                      className="w-24 h-8"
                      min={-1}
                      max={4294967295}
                      placeholder="-1"
                    />
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

      {/* Painter Dialog */}
      {painterImage && (
        <PainterDialog
          open={!!painterImage}
          onOpenChange={(open) => !open && setPainterImage(null)}
          image={painterImage}
          existingMask={imageMasks.get(painterImage.id) ?? null}
          onSave={handleSaveMask}
          onReadFullImage={handleReadFullImage}
        />
      )}
    </div>
  );
});
