import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
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
} from "lucide-react";

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
