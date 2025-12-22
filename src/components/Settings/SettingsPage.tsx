import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
    organize_by_date: true,
    save_metadata: true,
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
          organize_by_date: cfg.organize_by_date,
          save_metadata: cfg.save_metadata,
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
      toast.success("Settings saved successfully");
    } catch (e) {
      toast.error(`Failed to save: ${e}`);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await saveSettings(formData);
      await testConnection();
      toast.success("Connection successful!");
    } catch (e) {
      toast.error(`Connection failed: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const handleClearSettings = async () => {
    if (confirm("Are you sure you want to clear all settings?")) {
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
          organize_by_date: true,
          save_metadata: true,
        });
        toast.info("Settings cleared");
      } catch (e) {
        toast.error(`Failed to clear: ${e}`);
      }
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Output Directory",
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
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Configure your API credentials and output preferences
          </p>
        </div>
      </div>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            API Configuration
          </CardTitle>
          <CardDescription>
            Configure your AI API credentials and model settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base_url">Base URL</Label>
            <Input
              id="base_url"
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
              value={formData.base_url}
              onChange={(e) =>
                setFormData({ ...formData, base_url: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">API endpoint URL</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_token">API Token</Label>
            <div className="relative">
              <Input
                id="api_token"
                type={showToken ? "text" : "password"}
                placeholder={
                  config?.api_token_set
                    ? "••••••••••••••••"
                    : "Enter your API token"
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
                ? "Token is set. Enter new value to update."
                : "Bearer token for authentication"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image_model">Image Model</Label>
            <Input
              id="image_model"
              placeholder="doubao-seedream-4-5-251128"
              value={formData.image_model}
              onChange={(e) =>
                setFormData({ ...formData, image_model: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Model ID for image generation
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="video_model">Video Model (optional)</Label>
            <Input
              id="video_model"
              placeholder="doubao-seedance-1-0-pro-250528"
              value={formData.video_model}
              onChange={(e) =>
                setFormData({ ...formData, video_model: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Model ID for video generation
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
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Output Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="w-5 h-5" />
            Output Settings
          </CardTitle>
          <CardDescription>
            Configure where and how generated images are saved
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Output Directory</Label>
            <div className="flex gap-2">
              <Input
                value={formData.output_directory}
                onChange={(e) =>
                  setFormData({ ...formData, output_directory: e.target.value })
                }
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectDirectory}>
                Browse
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
            <Label>Output Format</Label>
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

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="organize_by_date">Organize by Date</Label>
              <p className="text-xs text-muted-foreground">
                Create subfolders by year-month
              </p>
            </div>
            <Switch
              id="organize_by_date"
              checked={formData.organize_by_date}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, organize_by_date: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="save_metadata">Save Metadata</Label>
              <p className="text-xs text-muted-foreground">
                Save prompt and settings as JSON alongside images
              </p>
            </div>
            <Switch
              id="save_metadata"
              checked={formData.save_metadata}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, save_metadata: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Settings"
          )}
        </Button>
        <Button variant="destructive" onClick={handleClearSettings}>
          <Trash2 className="w-4 h-4 mr-2" />
          Clear All
        </Button>
      </div>
    </div>
  );
}
