import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";
import type { Project, CreateProjectRequest } from "@/types";

interface WelcomeScreenProps {
  onCreateProject: (request: CreateProjectRequest) => Promise<Project>;
  onSelectProject: (project: Project) => void;
}

export function WelcomeScreen({ onCreateProject, onSelectProject }: WelcomeScreenProps) {
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!projectName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const project = await onCreateProject({
        name: projectName.trim(),
      });
      onSelectProject(project);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && projectName.trim()) {
      handleCreate();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-background">
      <div className="max-w-md w-full px-8 text-center">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">欢迎使用 AI 艺术工作站</h1>
          <p className="text-muted-foreground">
            创建一个项目开始生成图片和视频
          </p>
        </div>

        <div className="space-y-4">
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="我的第一个项目"
            className="text-center text-lg h-12"
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button
            onClick={handleCreate}
            disabled={!projectName.trim() || creating}
            className="w-full h-12 text-lg"
          >
            {creating ? "创建中..." : "创建项目"}
          </Button>
        </div>
      </div>
    </div>
  );
}
