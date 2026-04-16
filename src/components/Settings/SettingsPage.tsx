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
import { useSettings, useFiles } from "../../hooks";
import type { SaveConfigRequest } from "../../types";
import {
  Key,
  Folder,
  Eye,
  EyeOff,
  Loader2,
  FolderOpen,
  Trash2,
  ArrowLeft,
  Music,
  Download,
  CheckCircle2,
  AlertCircle,
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
  const {
    config,
    loading,
    loadSettings,
    saveSettings,
    testConnection,
    clearSettings,
    getDefaultOutputDir,
  } = useSettings();
  const { openFolder } = useFiles();

  const [formData, setFormData] = useState<SaveConfigRequest>({
    base_url: "",
    api_token: "",
    image_model: "",
    video_model: "",
    output_directory: "",
    output_format: "jpeg",
  });

  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);

  // Stem model state
  const [stemStatus, setStemStatus] = useState<StemModelStatus | null>(null);
  const [stemDownloading, setStemDownloading] = useState(false);
  const [stemProgress, setStemProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [stemError, setStemError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then((cfg) => {
      if (cfg) {
        setFormData({
          base_url: cfg.base_url,
          api_token: "",
          image_model: cfg.image_model,
          video_model: cfg.video_model,
          output_directory: cfg.output_directory,
          output_format: cfg.output_format,
        });
      }
    });
  }, [loadSettings]);

  useEffect(() => {
    if (!formData.output_directory) {
      getDefaultOutputDir().then((dir) => {
        setFormData((prev) => ({ ...prev, output_directory: dir }));
      });
    }
  }, [getDefaultOutputDir, formData.output_directory]);

  // Load stem model status on mount
  useEffect(() => {
    invoke<StemModelStatus>("check_stem_model_status")
      .then(setStemStatus)
      .catch(() => {});
  }, []);

  // Listen for download progress events
  useEffect(() => {
    const unlisten = listen<[number, number]>("stem-model-download-progress", (event) => {
      const [downloaded, total] = event.payload;
      setStemProgress({ downloaded, total });
    });
    return () => { unlisten.then((fn) => fn()); };
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

  const handleSave = async () => {
    try {
      await saveSettings(formData);
      toast.success("设置已保存");
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await saveSettings(formData);
      await testConnection();
      toast.success("连接成功！");
    } catch (e) {
      toast.error(`连接失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const handleClearSettings = async () => {
    if (confirm("确定要清除所有设置吗？")) {
      try {
        await clearSettings();
        const defaultDir = await getDefaultOutputDir();
        setFormData({
          base_url: "",
          api_token: "",
          image_model: "",
          video_model: "",
          output_directory: defaultDir,
          output_format: "jpeg",
        });
        toast.info("设置已清除");
      } catch (e) {
        toast.error(`清除失败: ${e}`);
      }
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
        setFormData((prev) => ({
          ...prev,
          output_directory: selected as string,
        }));
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    }
  };

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
          <p className="text-muted-foreground">
            配置API凭据和输出偏好设置
          </p>
        </div>
      </div>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            API 配置
          </CardTitle>
          <CardDescription>
            配置AI API凭据和模型设置
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base_url">基础URL</Label>
            <Input
              id="base_url"
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
              value={formData.base_url}
              onChange={(e) =>
                setFormData({ ...formData, base_url: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">API端点URL</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_token">API令牌</Label>
            <div className="relative">
              <Input
                id="api_token"
                type={showToken ? "text" : "password"}
                placeholder={
                  config?.api_token_set
                    ? "••••••••••••••••"
                    : "输入您的API令牌"
                }
                value={formData.api_token}
                onChange={(e) =>
                  setFormData({ ...formData, api_token: e.target.value })
                }
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Eye className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {config?.api_token_set
                ? "令牌已设置。输入新值以更新。"
                : "用于身份验证的Bearer令牌"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image_model">图片模型</Label>
            <Input
              id="image_model"
              placeholder="doubao-seedream-4-5-251128"
              value={formData.image_model}
              onChange={(e) =>
                setFormData({ ...formData, image_model: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              用于图片生成的模型ID
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="video_model">视频模型（可选）</Label>
            <Input
              id="video_model"
              placeholder="doubao-seedance-1-0-pro-250528"
              value={formData.video_model}
              onChange={(e) =>
                setFormData({ ...formData, video_model: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              用于视频生成的模型ID
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                测试中...
              </>
            ) : (
              "测试连接"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Output Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="w-5 h-5" />
            输出设置
          </CardTitle>
          <CardDescription>
            配置生成图片的保存位置和方式
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>输出目录</Label>
            <div className="flex gap-2">
              <Input
                value={formData.output_directory}
                onChange={(e) =>
                  setFormData({ ...formData, output_directory: e.target.value })
                }
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectDirectory}>
                浏览
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => openFolder(formData.output_directory)}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>输出格式</Label>
            <Select
              value={formData.output_format}
              onValueChange={(value) =>
                setFormData({ ...formData, output_format: value })
              }
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
            下载 HTDemucs 模型，自动从视频中分离人声和背景音乐。分离后的音轨可作为参考音频使用，保持角色声音和 BGM 的一致性。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
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

          {/* Progress bar */}
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
                  <span>{Math.round((stemProgress.downloaded / stemProgress.total) * 100)}%</span>
                )}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width: stemProgress && stemProgress.total > 0
                      ? `${(stemProgress.downloaded / stemProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {stemError && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{stemError}</span>
            </div>
          )}

          {/* Download button */}
          {!stemStatus?.downloaded && (
            <Button
              onClick={handleDownloadStemModel}
              disabled={stemDownloading}
            >
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

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              保存中...
            </>
          ) : (
            "保存设置"
          )}
        </Button>
        <Button variant="destructive" onClick={handleClearSettings}>
          <Trash2 className="w-4 h-4 mr-2" />
          清除全部
        </Button>
      </div>
    </div>
  );
}
