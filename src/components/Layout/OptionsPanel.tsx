import { useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { MediaDropZone } from "../Generation/MediaDropZone";
import type { MediaFile } from "../Generation/MediaDropZone";
import { PainterDialog } from "../Painter";
import { DynamicForm, defaultsForFields } from "../DynamicForm";
import { useImageGeneration, useSettings, useProviders, useGallery } from "../../hooks";
import type {
  ReferenceImage,
  GenerateImageRequestWithPaths,
  GenerateVideoRequestWithPaths,
  VideoGenerationType,
  OptionsPanelHandle,
  MaskData,
  ProviderDescriptor,
  ProviderInstance,
  GenerationManifest,
} from "../../types";
import {
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Video,
  FileVideo,
  FileAudio,
} from "lucide-react";
import { cn } from "@/lib/utils";

type GenerationMode = "image" | "video";

const LAST_PROVIDER_IMAGE_KEY = "ai-artstation.last-provider.image";
const LAST_PROVIDER_VIDEO_KEY = "ai-artstation.last-provider.video";

interface OptionsPanelProps {
  projectId: string;
  onStartImageTask: (request: GenerateImageRequestWithPaths) => string;
  onStartVideoTask?: (request: GenerateVideoRequestWithPaths) => void;
}

export const OptionsPanel = forwardRef<OptionsPanelHandle, OptionsPanelProps>(
  function OptionsPanel({ projectId, onStartImageTask, onStartVideoTask }, ref) {
    return (
      <OptionsPanelInner
        projectId={projectId}
        onStartImageTask={onStartImageTask}
        onStartVideoTask={onStartVideoTask}
        handleRef={ref}
      />
    );
  }
);

interface InnerProps extends OptionsPanelProps {
  handleRef: React.ForwardedRef<OptionsPanelHandle>;
}

function OptionsPanelInner({
  projectId,
  onStartImageTask,
  onStartVideoTask,
  handleRef,
}: InnerProps) {
  const { readImageFile } = useImageGeneration();
  const { settings, loadSettings } = useSettings();
  const { providers, descriptors, loadProviders } = useProviders();
  const { readImageRaw } = useGallery();

  const [isOpen, setIsOpen] = useState(true);
  const [mode, setMode] = useState<GenerationMode>("image");
  const [prompt, setPrompt] = useState("");

  // Provider selection — keyed by provider_type (single instance per type).
  const [imageProviderType, setImageProviderType] = useState<string | null>(null);
  const [videoProviderType, setVideoProviderType] = useState<string | null>(null);

  // Dynamic params per mode. Seeded from manifest defaults.
  const [imageParams, setImageParams] = useState<Record<string, unknown>>({});
  const [videoParams, setVideoParams] = useState<Record<string, unknown>>({});

  // Reference media
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [imageMasks, setImageMasks] = useState<Map<string, MaskData>>(new Map());
  const [painterImage, setPainterImage] = useState<ReferenceImage | null>(null);

  const [videoFirstFrame, setVideoFirstFrame] = useState<ReferenceImage | null>(null);
  const [videoLastFrame, setVideoLastFrame] = useState<ReferenceImage | null>(null);
  const [videoRefImages, setVideoRefImages] = useState<ReferenceImage[]>([]);
  const [videoRefVideos, setVideoRefVideos] = useState<MediaFile[]>([]);
  const [videoRefAudios, setVideoRefAudios] = useState<MediaFile[]>([]);
  const [multimodalTab, setMultimodalTab] = useState<"image" | "video" | "audio">("image");

  useEffect(() => {
    loadSettings().catch(() => {});
    loadProviders().catch(() => {});
  }, [loadSettings, loadProviders]);

  // Derived: providers capable of each mode (must have the corresponding model filled).
  const imageProviders = useMemo(
    () => providers.filter((p) => !!p.image_model),
    [providers],
  );
  const videoProviders = useMemo(
    () => providers.filter((p) => !!p.video_model),
    [providers],
  );

  const descriptorByType = useMemo(() => {
    const map: Record<string, ProviderDescriptor> = {};
    for (const d of descriptors) map[d.provider_type] = d;
    return map;
  }, [descriptors]);

  // Pick an initial provider for each mode: last-used (localStorage) →
  // app-settings default → first capable provider.
  useEffect(() => {
    if (imageProviders.length > 0 && !imageProviderType) {
      const last = localStorage.getItem(LAST_PROVIDER_IMAGE_KEY);
      const candidates = [last, settings?.default_image_provider_type, imageProviders[0]?.provider_type];
      const picked = candidates.find(
        (t) => t && imageProviders.some((p) => p.provider_type === t),
      );
      if (picked) setImageProviderType(picked);
    }
    if (videoProviders.length > 0 && !videoProviderType) {
      const last = localStorage.getItem(LAST_PROVIDER_VIDEO_KEY);
      const candidates = [last, settings?.default_video_provider_type, videoProviders[0]?.provider_type];
      const picked = candidates.find(
        (t) => t && videoProviders.some((p) => p.provider_type === t),
      );
      if (picked) setVideoProviderType(picked);
    }
  }, [imageProviders, videoProviders, settings, imageProviderType, videoProviderType]);

  // If the current provider disappears (deleted or model cleared), fall back.
  useEffect(() => {
    if (imageProviderType && !imageProviders.some((p) => p.provider_type === imageProviderType)) {
      setImageProviderType(imageProviders[0]?.provider_type ?? null);
    }
    if (videoProviderType && !videoProviders.some((p) => p.provider_type === videoProviderType)) {
      setVideoProviderType(videoProviders[0]?.provider_type ?? null);
    }
  }, [imageProviders, videoProviders, imageProviderType, videoProviderType]);

  // Persist last-used provider per mode.
  useEffect(() => {
    if (imageProviderType) localStorage.setItem(LAST_PROVIDER_IMAGE_KEY, imageProviderType);
  }, [imageProviderType]);
  useEffect(() => {
    if (videoProviderType) localStorage.setItem(LAST_PROVIDER_VIDEO_KEY, videoProviderType);
  }, [videoProviderType]);

  const imageProvider: ProviderInstance | undefined = providers.find(
    (p) => p.provider_type === imageProviderType,
  );
  const videoProvider: ProviderInstance | undefined = providers.find(
    (p) => p.provider_type === videoProviderType,
  );

  const imageManifest: GenerationManifest | null =
    (imageProviderType && descriptorByType[imageProviderType]?.image_manifest) || null;
  const videoManifest: GenerationManifest | null =
    (videoProviderType && descriptorByType[videoProviderType]?.video_manifest) || null;

  // Seed default params when manifest becomes available (or changes).
  useEffect(() => {
    if (imageManifest && Object.keys(imageParams).length === 0) {
      setImageParams(defaultsForFields(imageManifest.params));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageManifest]);

  useEffect(() => {
    if (videoManifest && Object.keys(videoParams).length === 0) {
      setVideoParams(defaultsForFields(videoManifest.params));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoManifest]);

  // When user switches provider, reset params to the new manifest's defaults so
  // stale keys don't leak across providers.
  useEffect(() => {
    if (imageManifest) setImageParams(defaultsForFields(imageManifest.params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageProviderType]);
  useEffect(() => {
    if (videoManifest) setVideoParams(defaultsForFields(videoManifest.params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoProviderType]);

  useImperativeHandle(
    handleRef,
    () => ({
      cleanupDeletedFile: (filePath: string) => {
        setReferenceImages((prev) => {
          const filtered = prev.filter((img) => img.file_path !== filePath);
          const removedIds = prev.filter((img) => img.file_path === filePath).map((img) => img.id);
          if (removedIds.length > 0) {
            setImageMasks((prevMasks) => {
              const next = new Map(prevMasks);
              removedIds.forEach((id) => next.delete(id));
              return next;
            });
          }
          return filtered;
        });
        setVideoFirstFrame((prev) => (prev?.file_path === filePath ? null : prev));
        setVideoLastFrame((prev) => (prev?.file_path === filePath ? null : prev));
        setVideoRefImages((prev) => prev.filter((img) => img.file_path !== filePath));
        setVideoRefVideos((prev) => prev.filter((f) => f.path !== filePath));
        setVideoRefAudios((prev) => prev.filter((f) => f.path !== filePath));
      },
    }),
    [],
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
    [readImageFile],
  );

  const handleImageClick = useCallback((image: ReferenceImage) => {
    setPainterImage(image);
  }, []);

  const handleSaveMask = useCallback((maskData: MaskData) => {
    setImageMasks((prev) => {
      const next = new Map(prev);
      next.set(maskData.image_id, maskData);
      return next;
    });
  }, []);

  const handleReadFullImage = useCallback(
    async (path: string): Promise<string> => readImageRaw(path),
    [readImageRaw],
  );

  const handleReferenceImagesChange = useCallback((newImages: ReferenceImage[]) => {
    setReferenceImages((prev) => {
      const newIds = new Set(newImages.map((img) => img.id));
      const removedIds = prev.filter((img) => !newIds.has(img.id)).map((img) => img.id);
      if (removedIds.length > 0) {
        setImageMasks((prevMasks) => {
          const next = new Map(prevMasks);
          removedIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      return newImages;
    });
  }, []);

  const handleVideoFrameChange = useCallback(
    (setter: (img: ReferenceImage | null) => void) => (images: ReferenceImage[]) => {
      setter(images.length > 0 ? images[0] : null);
    },
    [],
  );

  const toImageInput = (img: ReferenceImage | null) =>
    img ? { base64: img.base64, file_path: img.file_path } : undefined;

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("请输入提示词");
      return;
    }

    if (mode === "image") {
      if (!imageProvider || !imageManifest) {
        toast.error("请先选择图像 Provider");
        return;
      }

      const processedInputs = referenceImages.map((img) => {
        const mask = imageMasks.get(img.id);
        return {
          base64: img.base64,
          file_path: img.file_path,
          mask_base64: mask?.mask_base64,
        };
      });

      const request: GenerateImageRequestWithPaths = {
        project_id: projectId,
        provider_type: imageProvider.provider_type,
        prompt: prompt.trim(),
        reference_image_inputs: processedInputs,
        params: imageParams,
      };
      onStartImageTask(request);
      return;
    }

    // video
    if (!videoProvider || !videoManifest) {
      toast.error("请先选择视频 Provider");
      return;
    }
    if (!onStartVideoTask) {
      toast.error("视频生成功能未启用");
      return;
    }

    const generationType =
      (videoManifest.generation_type_key
        ? (videoParams[videoManifest.generation_type_key] as VideoGenerationType | undefined)
        : undefined) ?? "text-to-video";

    if (generationType === "image-to-video-first" && !videoFirstFrame) {
      toast.error("请上传首帧图片");
      return;
    }
    if (generationType === "image-to-video-both" && (!videoFirstFrame || !videoLastFrame)) {
      toast.error("请上传首帧和尾帧图片");
      return;
    }
    if (generationType === "image-to-video-ref" && videoRefImages.length === 0) {
      toast.error("请上传至少一张参考图片");
      return;
    }
    if (generationType === "multimodal-ref") {
      if (videoRefImages.length === 0 && videoRefVideos.length === 0) {
        toast.error("多模态参考至少需要一张图片或一个视频");
        return;
      }
      if (
        videoRefAudios.length > 0 &&
        videoRefImages.length === 0 &&
        videoRefVideos.length === 0
      ) {
        toast.error("不可单独输入音频，应至少包含1个参考视频或图片");
        return;
      }
    }

    const request: GenerateVideoRequestWithPaths = {
      project_id: projectId,
      provider_type: videoProvider.provider_type,
      prompt: prompt.trim(),
      generation_type: generationType,
      first_frame_input: toImageInput(videoFirstFrame),
      last_frame_input: toImageInput(videoLastFrame),
      reference_image_inputs: videoRefImages.map((img) => ({
        base64: img.base64,
        file_path: img.file_path,
      })),
      reference_video_paths: videoRefVideos.map((v) => v.path),
      reference_audio_paths: videoRefAudios.map((a) => a.path),
      params: videoParams,
    };
    onStartVideoTask(request);
  };

  const videoGenerationType: VideoGenerationType =
    (videoManifest?.generation_type_key
      ? (videoParams[videoManifest.generation_type_key] as VideoGenerationType | undefined)
      : undefined) ?? "text-to-video";

  const canGenerateImage = !!imageProvider && !!imageManifest && prompt.trim().length > 0;
  const canGenerateVideo = !!videoProvider && !!videoManifest && prompt.trim().length > 0;

  const providerChoices = mode === "image" ? imageProviders : videoProviders;
  const selectedProviderType = mode === "image" ? imageProviderType : videoProviderType;
  const setSelectedProviderType = mode === "image" ? setImageProviderType : setVideoProviderType;

  return (
    <div className="border-t bg-background">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
                    : "text-muted-foreground hover:text-foreground",
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
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Video className="w-4 h-4" />
                视频
              </button>
            </div>

            {/* Provider selector — only show when more than one candidate */}
            {providerChoices.length > 1 && (
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select
                    value={selectedProviderType ?? ""}
                    onValueChange={(v) => setSelectedProviderType(v)}
                  >
                    <SelectTrigger className="h-8 w-48">
                      <SelectValue placeholder="选择 Provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerChoices.map((p) => (
                        <SelectItem key={p.provider_type} value={p.provider_type}>
                          {descriptorByType[p.provider_type]?.display_name ?? p.provider_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {mode === "image" ? (
              <ImageBody
                prompt={prompt}
                setPrompt={setPrompt}
                referenceImages={referenceImages}
                onReferenceImagesChange={handleReferenceImagesChange}
                onReadImage={handleReadImage}
                maxReferenceImages={imageManifest?.features?.reference_images ?? 14}
                imageMasks={imageMasks}
                onImageClick={handleImageClick}
                manifest={imageManifest}
                params={imageParams}
                onParamsChange={setImageParams}
                onGenerate={handleGenerate}
                canGenerate={canGenerateImage}
              />
            ) : (
              <VideoBody
                prompt={prompt}
                setPrompt={setPrompt}
                manifest={videoManifest}
                params={videoParams}
                onParamsChange={setVideoParams}
                generationType={videoGenerationType}
                videoFirstFrame={videoFirstFrame}
                setVideoFirstFrame={setVideoFirstFrame}
                videoLastFrame={videoLastFrame}
                setVideoLastFrame={setVideoLastFrame}
                videoRefImages={videoRefImages}
                setVideoRefImages={setVideoRefImages}
                videoRefVideos={videoRefVideos}
                setVideoRefVideos={setVideoRefVideos}
                videoRefAudios={videoRefAudios}
                setVideoRefAudios={setVideoRefAudios}
                multimodalTab={multimodalTab}
                setMultimodalTab={setMultimodalTab}
                onReadImage={handleReadImage}
                handleVideoFrameChange={handleVideoFrameChange}
                onGenerate={handleGenerate}
                canGenerate={canGenerateVideo}
              />
            )}

            {providerChoices.length === 0 && (
              <p className="text-xs text-yellow-500">
                {mode === "image"
                  ? "没有配置图像模型的 Provider，请在设置中添加"
                  : "没有配置视频模型的 Provider，请在设置中添加"}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

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
}

// ============================================================================
// Image body
// ============================================================================

interface ImageBodyProps {
  prompt: string;
  setPrompt: (v: string) => void;
  referenceImages: ReferenceImage[];
  onReferenceImagesChange: (imgs: ReferenceImage[]) => void;
  onReadImage: (path: string) => Promise<Omit<ReferenceImage, "id">>;
  maxReferenceImages: number;
  imageMasks: Map<string, MaskData>;
  onImageClick: (img: ReferenceImage) => void;
  manifest: GenerationManifest | null;
  params: Record<string, unknown>;
  onParamsChange: (p: Record<string, unknown>) => void;
  onGenerate: () => void;
  canGenerate: boolean;
}

function ImageBody({
  prompt,
  setPrompt,
  referenceImages,
  onReferenceImagesChange,
  onReadImage,
  maxReferenceImages,
  imageMasks,
  onImageClick,
  manifest,
  params,
  onParamsChange,
  onGenerate,
  canGenerate,
}: ImageBodyProps) {
  return (
    <>
      <div className="flex gap-4 items-stretch">
        <div className="flex-1 flex flex-col gap-2">
          <Label htmlFor="prompt" className="flex-shrink-0">
            提示词
          </Label>
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
            onImagesChange={onReferenceImagesChange}
            onReadImage={onReadImage}
            maxImages={maxReferenceImages}
            dropZoneType="image-ref"
            imageMasks={imageMasks}
            onImageClick={onImageClick}
          />
        </div>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        {manifest && (
          <DynamicForm
            inline
            fields={manifest.params}
            values={params}
            onChange={(k, v) => onParamsChange({ ...params, [k]: v })}
          />
        )}
        <div className="ml-auto">
          <Button onClick={onGenerate} disabled={!canGenerate} size="lg" className="px-8">
            生成
          </Button>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Video body
// ============================================================================

interface VideoBodyProps {
  prompt: string;
  setPrompt: (v: string) => void;
  manifest: GenerationManifest | null;
  params: Record<string, unknown>;
  onParamsChange: (p: Record<string, unknown>) => void;
  generationType: VideoGenerationType;
  videoFirstFrame: ReferenceImage | null;
  setVideoFirstFrame: (v: ReferenceImage | null) => void;
  videoLastFrame: ReferenceImage | null;
  setVideoLastFrame: (v: ReferenceImage | null) => void;
  videoRefImages: ReferenceImage[];
  setVideoRefImages: (imgs: ReferenceImage[]) => void;
  videoRefVideos: MediaFile[];
  setVideoRefVideos: (v: MediaFile[]) => void;
  videoRefAudios: MediaFile[];
  setVideoRefAudios: (v: MediaFile[]) => void;
  multimodalTab: "image" | "video" | "audio";
  setMultimodalTab: (t: "image" | "video" | "audio") => void;
  onReadImage: (path: string) => Promise<Omit<ReferenceImage, "id">>;
  handleVideoFrameChange: (
    setter: (img: ReferenceImage | null) => void,
  ) => (images: ReferenceImage[]) => void;
  onGenerate: () => void;
  canGenerate: boolean;
}

function VideoBody({
  prompt,
  setPrompt,
  manifest,
  params,
  onParamsChange,
  generationType,
  videoFirstFrame,
  setVideoFirstFrame,
  videoLastFrame,
  setVideoLastFrame,
  videoRefImages,
  setVideoRefImages,
  videoRefVideos,
  setVideoRefVideos,
  videoRefAudios,
  setVideoRefAudios,
  multimodalTab,
  setMultimodalTab,
  onReadImage,
  handleVideoFrameChange,
  onGenerate,
  canGenerate,
}: VideoBodyProps) {
  const maxRefImages = manifest?.features?.reference_images ?? 9;
  const maxRefVideos = manifest?.features?.reference_videos ?? 3;
  const maxRefAudios = manifest?.features?.reference_audios ?? 3;

  return (
    <>
      <div className="flex gap-4 items-stretch h-[168px]">
        <div className="flex-1 flex flex-col gap-2">
          <Label htmlFor="video-prompt" className="flex-shrink-0">
            提示词
          </Label>
          <Textarea
            id="video-prompt"
            placeholder="描述你想要生成的视频内容..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="resize-none flex-1"
          />
        </div>

        {generationType !== "text-to-video" && (
          <div className="w-64 flex-shrink-0 h-full">
            {generationType === "image-to-video-first" && (
              <div className="h-full">
                <ImageDropZone
                  images={videoFirstFrame ? [videoFirstFrame] : []}
                  onImagesChange={handleVideoFrameChange(setVideoFirstFrame)}
                  onReadImage={onReadImage}
                  maxImages={1}
                  label="首帧图片"
                  singleImageFill
                  dropZoneType="video-first"
                />
              </div>
            )}
            {generationType === "image-to-video-both" && (
              <div className="flex gap-2 h-full">
                <div className="flex-1 h-full">
                  <ImageDropZone
                    images={videoFirstFrame ? [videoFirstFrame] : []}
                    onImagesChange={handleVideoFrameChange(setVideoFirstFrame)}
                    onReadImage={onReadImage}
                    maxImages={1}
                    label="首帧"
                    singleImageFill
                    dropZoneType="video-both-first"
                    onVideoFrameDrop={(_first, last) => {
                      if (last) setVideoLastFrame(last);
                    }}
                  />
                </div>
                <div className="flex-1 h-full">
                  <ImageDropZone
                    images={videoLastFrame ? [videoLastFrame] : []}
                    onImagesChange={handleVideoFrameChange(setVideoLastFrame)}
                    onReadImage={onReadImage}
                    maxImages={1}
                    label="尾帧"
                    singleImageFill
                    dropZoneType="video-both-last"
                  />
                </div>
              </div>
            )}
            {generationType === "image-to-video-ref" && (
              <ImageDropZone
                images={videoRefImages}
                onImagesChange={setVideoRefImages}
                onReadImage={onReadImage}
                maxImages={maxRefImages}
                label={`参考图片 (${videoRefImages.length}/${maxRefImages})`}
                dropZoneType="video-ref"
              />
            )}
            {generationType === "multimodal-ref" && (
              <div className="flex flex-col h-full gap-1">
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setMultimodalTab("image")}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors",
                      multimodalTab === "image"
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground",
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
                        : "text-muted-foreground hover:text-foreground",
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
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <FileAudio className="w-3 h-3" />
                    音频{videoRefAudios.length > 0 && ` (${videoRefAudios.length})`}
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  {multimodalTab === "image" && (
                    <ImageDropZone
                      images={videoRefImages}
                      onImagesChange={setVideoRefImages}
                      onReadImage={onReadImage}
                      maxImages={maxRefImages}
                      label={`参考图片 (${videoRefImages.length}/${maxRefImages})`}
                      dropZoneType="video-ref"
                    />
                  )}
                  {multimodalTab === "video" && (
                    <MediaDropZone
                      files={videoRefVideos}
                      onFilesChange={setVideoRefVideos}
                      maxFiles={maxRefVideos}
                      extensions={["mp4", "mov"]}
                      label={`参考视频 (${videoRefVideos.length}/${maxRefVideos})`}
                      mediaType="video"
                      maxSizeMB={50}
                    />
                  )}
                  {multimodalTab === "audio" && (
                    <MediaDropZone
                      files={videoRefAudios}
                      onFilesChange={setVideoRefAudios}
                      maxFiles={maxRefAudios}
                      extensions={["wav", "mp3"]}
                      label={`参考音频 (${videoRefAudios.length}/${maxRefAudios})`}
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

      <div className="flex items-end gap-4 flex-wrap">
        {manifest && (
          <DynamicForm
            inline
            fields={manifest.params}
            values={params}
            onChange={(k, v) => onParamsChange({ ...params, [k]: v })}
          />
        )}
        <div className="ml-auto">
          <Button onClick={onGenerate} disabled={!canGenerate} size="lg" className="px-8">
            生成视频
          </Button>
        </div>
      </div>
    </>
  );
}


