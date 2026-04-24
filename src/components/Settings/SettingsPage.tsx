import { useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSettings, useProviders, useFiles } from "../../hooks";
import { ProviderFormDialog } from "./ProviderFormDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppSettings, ProviderInstance } from "../../types";
import {
  Folder,
  Loader2,
  FolderOpen,
  ArrowLeft,
  Music,
  Download,
  CheckCircle2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Key,
} from "lucide-react";

interface StemModelStatus {
  downloaded: boolean;
  model_size_mb: number;
  cache_path: string;
}

interface SettingsPageProps {
  onBack?: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const { loadSettings, saveSettings, getDefaultOutputDir } = useSettings();
  const { providers, descriptors, loadProviders, deleteProvider } = useProviders();
  const { openFolder } = useFiles();

  const [form, setForm] = useState<AppSettings>({
    output_directory: "",
    output_format: "jpeg",
    default_image_provider_type: null,
    default_video_provider_type: null,
  });
  const [saving, setSaving] = useState(false);

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [dialogProviderType, setDialogProviderType] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProviderInstance | undefined>(undefined);

  const [stemStatus, setStemStatus] = useState<StemModelStatus | null>(null);
  const [stemDownloading, setStemDownloading] = useState(false);
  const [stemProgress, setStemProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [stemError, setStemError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then((cfg) => {
      if (cfg) setForm(cfg);
    });
    loadProviders().catch(() => {});
  }, [loadSettings, loadProviders]);

  useEffect(() => {
    if (!form.output_directory) {
      getDefaultOutputDir().then((dir) => {
        setForm((prev) => ({ ...prev, output_directory: dir }));
      });
    }
  }, [getDefaultOutputDir, form.output_directory]);

  useEffect(() => {
    invoke<StemModelStatus>("check_stem_model_status")
      .then(setStemStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<[number, number]>("stem-model-download-progress", (event) => {
      const [downloaded, total] = event.payload;
      setStemProgress({ downloaded, total });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleDownloadStemModel = useCallback(async () => {
    setStemDownloading(true);
    setStemError(null);
    setStemProgress(null);
    try {
      await invoke("download_stem_model");
      const status = await invoke<StemModelStatus>("check_stem_model_status");
      setStemStatus(status);
      toast.success("音频分离模型下载完成");
    } catch (e) {
      setStemError(String(e));
      toast.error(`模型下载失败: ${e}`);
    } finally {
      setStemDownloading(false);
      setStemProgress(null);
    }
  }, []);

  const handleDeleteStemModel = useCallback(async () => {
    if (!confirm("确定要删除音频分离模型吗？删除后需要重新下载才能使用音频分离功能。")) return;
    try {
      await invoke("delete_stem_model");
      const status = await invoke<StemModelStatus>("check_stem_model_status");
      setStemStatus(status);
      toast.info("音频分离模型已删除");
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    }
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await saveSettings(form);
      toast.success("设置已保存");
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择输出目录",
      });
      if (selected) {
        setForm((prev) => ({ ...prev, output_directory: selected as string }));
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    }
  };

  const handleAddProvider = (providerType: string) => {
    setEditingProvider(undefined);
    setDialogProviderType(providerType);
    setProviderDialogOpen(true);
  };

  const handleEditProvider = (p: ProviderInstance) => {
    setEditingProvider(p);
    setDialogProviderType(p.provider_type);
    setProviderDialogOpen(true);
  };

  const handleDeleteProvider = async (p: ProviderInstance) => {
    const descriptor = descriptors.find((d) => d.provider_type === p.provider_type);
    const label = descriptor?.display_name ?? p.provider_type;
    if (!confirm(`确定要删除 "${label}" 吗？`)) return;
    try {
      await deleteProvider(p.provider_type);
      const next = await loadSettings();
      if (next) setForm(next);
      toast.success("Provider 已删除");
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    }
  };

  const configuredTypes = new Set(providers.map((p) => p.provider_type));
  const availableDescriptors = descriptors.filter((d) => !configuredTypes.has(d.provider_type));
  const imageProviders = providers.filter((p) => !!p.image_model);
  const videoProviders = providers.filter((p) => !!p.video_model);

  const descriptorOf = (p: ProviderInstance) =>
    descriptors.find((d) => d.provider_type === p.provider_type);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-bold">设置</h1>
          <p className="text-muted-foreground">配置 AI Provider 和输出偏好</p>
        </div>
      </div>

      {/* Providers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                AI Provider
              </CardTitle>
              <CardDescription>
                管理用于图像/视频生成的 AI 服务提供方
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={availableDescriptors.length === 0}>
                  <Plus className="w-4 h-4 mr-1" />
                  添加
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {availableDescriptors.map((d) => (
                  <DropdownMenuItem
                    key={d.provider_type}
                    onSelect={() => handleAddProvider(d.provider_type)}
                  >
                    {d.display_name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              还没有配置 Provider，点击右上角"添加"开始配置。
            </p>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => {
                const d = descriptorOf(p);
                const badges: string[] = [];
                if (p.image_model) badges.push(`图像: ${p.image_model}`);
                if (p.video_model) badges.push(`视频: ${p.video_model}`);
                return (
                  <div
                    key={p.provider_type}
                    className="flex items-center gap-3 p-3 border rounded-md hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">
                        {d?.display_name ?? p.provider_type}
                      </div>
                      {badges.length > 0 && (
                        <div className="text-xs text-muted-foreground truncate">
                          {badges.join(" · ")}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditProvider(p)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteProvider(p)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {(imageProviders.length > 1 || videoProviders.length > 1) && (
            <div className="space-y-4 pt-2 border-t">
              {imageProviders.length > 1 && (
                <div className="space-y-2">
                  <Label>默认图像 Provider</Label>
                  <Select
                    value={form.default_image_provider_type ?? ""}
                    onValueChange={(v) =>
                      setForm({ ...form, default_image_provider_type: v || null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="未选择" />
                    </SelectTrigger>
                    <SelectContent>
                      {imageProviders.map((p) => (
                        <SelectItem key={p.provider_type} value={p.provider_type}>
                          {descriptorOf(p)?.display_name ?? p.provider_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {videoProviders.length > 1 && (
                <div className="space-y-2">
                  <Label>默认视频 Provider</Label>
                  <Select
                    value={form.default_video_provider_type ?? ""}
                    onValueChange={(v) =>
                      setForm({ ...form, default_video_provider_type: v || null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="未选择" />
                    </SelectTrigger>
                    <SelectContent>
                      {videoProviders.map((p) => (
                        <SelectItem key={p.provider_type} value={p.provider_type}>
                          {descriptorOf(p)?.display_name ?? p.provider_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Output Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="w-5 h-5" />
            输出设置
          </CardTitle>
          <CardDescription>配置生成文件的保存位置和格式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>输出目录</Label>
            <div className="flex gap-2">
              <Input
                value={form.output_directory}
                onChange={(e) =>
                  setForm({ ...form, output_directory: e.target.value })
                }
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectDirectory}>
                浏览
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => openFolder(form.output_directory)}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>输出格式</Label>
            <Select
              value={form.output_format}
              onValueChange={(value) => setForm({ ...form, output_format: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audio Stem Separation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="w-5 h-5" />
            音频分离模型
          </CardTitle>
          <CardDescription>
            下载 HTDemucs 模型，自动从视频中分离人声和背景音乐。分离后的音轨可作为参考音频使用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {stemStatus?.downloaded ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">模型已就绪</p>
                  <p className="text-xs text-muted-foreground">
                    {stemStatus.model_size_mb.toFixed(1)} MB · {stemStatus.cache_path}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={handleDeleteStemModel}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <Download className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">模型未下载</p>
                  <p className="text-xs text-muted-foreground">
                    HTDemucs v4 ONNX 模型（约 210 MB）
                  </p>
                </div>
              </>
            )}
          </div>

          {stemDownloading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {stemProgress && stemProgress.total > 0
                    ? `下载中 ${(stemProgress.downloaded / 1024 / 1024).toFixed(1)} / ${(stemProgress.total / 1024 / 1024).toFixed(1)} MB`
                    : "正在连接..."}
                </span>
                {stemProgress && stemProgress.total > 0 && (
                  <span>
                    {Math.round((stemProgress.downloaded / stemProgress.total) * 100)}%
                  </span>
                )}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width:
                      stemProgress && stemProgress.total > 0
                        ? `${(stemProgress.downloaded / stemProgress.total) * 100}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {stemError && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{stemError}</span>
            </div>
          )}

          {!stemStatus?.downloaded && (
            <Button onClick={handleDownloadStemModel} disabled={stemDownloading}>
              {stemDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  下载中...
                </>
              ) : stemError ? (
                "重试下载"
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  下载模型
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={handleSaveSettings} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              保存中...
            </>
          ) : (
            "保存设置"
          )}
        </Button>
      </div>

      <ProviderFormDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        providerType={dialogProviderType}
        existing={editingProvider}
        onSaved={async () => {
          // The dialog has its own useProviders() instance, so refreshing
          // this page's list needs an explicit reload here.
          await loadProviders();
          const next = await loadSettings();
          if (next) setForm(next);
        }}
      />
    </div>
  );
}
