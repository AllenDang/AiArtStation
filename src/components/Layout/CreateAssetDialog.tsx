import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import type { AssetType } from "@/types";
import { User, Mountain, Palette, Package } from "lucide-react";

interface CreateAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thumbnail?: string;
  onConfirm: (name: string, assetType: AssetType) => void;
}

const assetTypeOptions: { value: AssetType; label: string; icon: React.ElementType }[] = [
  { value: "character", label: "Character", icon: User },
  { value: "background", label: "Background", icon: Mountain },
  { value: "style", label: "Style", icon: Palette },
  { value: "prop", label: "Prop", icon: Package },
];

export function CreateAssetDialog({
  open,
  onOpenChange,
  thumbnail,
  onConfirm,
}: CreateAssetDialogProps) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("character");

  const handleConfirm = () => {
    if (name.trim()) {
      onConfirm(name.trim(), assetType);
      setName("");
      setAssetType("character");
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setName("");
    setAssetType("character");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add as Asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Thumbnail preview */}
          {thumbnail && (
            <div className="flex justify-center">
              <img
                src={thumbnail}
                alt="Preview"
                className="w-32 h-32 object-cover rounded-lg border"
              />
            </div>
          )}

          {/* Asset name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Enter asset name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Asset type */}
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assetTypeOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {opt.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            Add Asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
