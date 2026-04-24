import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useProviders } from "../../hooks";
import type { ProviderDescriptor, ProviderInstance } from "../../types";

interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The provider type this dialog is configuring (new or existing). */
  providerType: string | null;
  /** Existing saved instance if editing; undefined when creating. */
  existing?: ProviderInstance;
  onSaved?: () => void;
}

export function ProviderFormDialog({
  open,
  onOpenChange,
  providerType,
  existing,
  onSaved,
}: ProviderFormDialogProps) {
  const { descriptors, saveProvider, testConnection } = useProviders();

  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [imageModel, setImageModel] = useState<string>("");
  const [videoModel, setVideoModel] = useState<string>("");
  const [noProxy, setNoProxy] = useState<boolean>(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const descriptor: ProviderDescriptor | undefined = useMemo(
    () => descriptors.find((d) => d.provider_type === providerType),
    [descriptors, providerType],
  );

  // Reset state when dialog opens
  useEffect(() => {
    if (!open || !descriptor) return;
    if (existing) {
      // Pre-fill non-secrets so the user sees current values; leave secrets
      // blank and use a placeholder to indicate they're already saved.
      const initial: Record<string, string> = {};
      for (const f of descriptor.credential_schema) {
        initial[f.key] = f.secret ? "" : existing.credentials[f.key] ?? "";
      }
      setCredentials(initial);
      setImageModel(existing.image_model ?? "");
      setVideoModel(existing.video_model ?? "");
      setNoProxy(existing.no_proxy);
    } else {
      setCredentials({});
      setImageModel("");
      setVideoModel("");
      setNoProxy(false);
    }
    setShowSecret({});
  }, [open, existing, descriptor]);

  if (!descriptor) {
    return null;
  }

  const caps = descriptor.capabilities;
  const isEditing = !!existing;

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await testConnection(descriptor.provider_type, credentials, noProxy);
      toast.success("连接成功");
    } catch (e) {
      toast.error(`连接失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (caps.image && caps.video && !imageModel.trim() && !videoModel.trim()) {
      toast.error("请至少配置图像或视频模型");
      return;
    }
    setSaving(true);
    try {
      await saveProvider({
        provider_type: descriptor.provider_type,
        credentials,
        image_model: imageModel.trim() || null,
        video_model: videoModel.trim() || null,
        no_proxy: noProxy,
      });
      toast.success(isEditing ? "已更新" : "已添加");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "编辑 Provider" : "添加 Provider"}</DialogTitle>
          <DialogDescription>{descriptor.display_name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {descriptor.credential_schema.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>{f.label}</Label>
              <div className="relative">
                <Input
                  type={f.secret && !showSecret[f.key] ? "password" : "text"}
                  placeholder={
                    isEditing && f.secret ? "••••••••（留空则保留当前值）" : f.placeholder
                  }
                  value={credentials[f.key] ?? ""}
                  onChange={(e) => handleCredentialChange(f.key, e.target.value)}
                  className={f.secret ? "pr-10" : ""}
                />
                {f.secret && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() =>
                      setShowSecret((prev) => ({ ...prev, [f.key]: !prev[f.key] }))
                    }
                  >
                    {showSecret[f.key] ? (
                      <EyeOff className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {caps.image && (
            <div className="space-y-2">
              <Label>图像模型名称{!caps.video ? "" : "（可选）"}</Label>
              <Input
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                placeholder="例如：doubao-seedream-4-5-251128"
              />
              <p className="text-xs text-muted-foreground">
                用于图像生成的模型 ID。留空表示不使用此 Provider 做图像生成。
              </p>
            </div>
          )}

          {caps.video && (
            <div className="space-y-2">
              <Label>视频模型名称{!caps.image ? "" : "（可选）"}</Label>
              <Input
                value={videoModel}
                onChange={(e) => setVideoModel(e.target.value)}
                placeholder="例如：doubao-seedance-1-0-pro-250528"
              />
              <p className="text-xs text-muted-foreground">
                用于视频生成的模型 ID。留空表示不使用此 Provider 做视频生成。
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="no-proxy" className="cursor-pointer">
                绕过系统代理
              </Label>
              <p className="text-xs text-muted-foreground">
                适用于国内中转（如已有 VPN 但需要直连中转 API）。访问国外 API 时请保持关闭。
              </p>
            </div>
            <Switch id="no-proxy" checked={noProxy} onCheckedChange={setNoProxy} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                测试中
              </>
            ) : (
              "测试连接"
            )}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                保存中
              </>
            ) : (
              "保存"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
