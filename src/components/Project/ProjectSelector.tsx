import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FolderOpen, MoreVertical, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Project, CreateProjectRequest } from "@/types";

interface ProjectSelectorProps {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (project: Project | null) => void;
  onCreateProject: (request: CreateProjectRequest) => Promise<Project>;
  onDeleteProject: (id: string) => Promise<void>;
}

export function ProjectSelector({
  projects,
  currentProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
}: ProjectSelectorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete confirmation state
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const project = await onCreateProject({
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      });
      onSelectProject(project);
      setDialogOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
    } catch (e) {
      console.error("Failed to create project:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleSelectChange = (value: string) => {
    if (value === "new") {
      setDialogOpen(true);
    } else {
      const project = projects.find((p) => p.id === value);
      onSelectProject(project || null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;

    setIsDeleting(true);
    try {
      await onDeleteProject(projectToDelete.id);
      toast.success(`项目 "${projectToDelete.name}" 已删除`);

      // If we deleted the current project, select another one
      if (currentProject?.id === projectToDelete.id) {
        const remaining = projects.filter((p) => p.id !== projectToDelete.id);
        onSelectProject(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (e) {
      toast.error(`删除项目失败: ${e}`);
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-muted-foreground" />
        <Select
          value={currentProject?.id || ""}
          onValueChange={handleSelectChange}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="选择项目..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
            <SelectItem value="new" className="text-primary">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                新建项目
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Project actions menu */}
        {currentProject && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setProjectToDelete(currentProject)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                删除项目
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新项目</DialogTitle>
            <DialogDescription>
              创建项目来整理您生成的图片和视频。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">项目名称</Label>
              <Input
                id="name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="我的漫画第一集"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">描述（可选）</Label>
              <Textarea
                id="description"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="项目的简要描述..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creating}
            >
              {creating ? "创建中..." : "创建项目"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!projectToDelete} onOpenChange={(open: boolean) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 "{projectToDelete?.name}" 吗？
              这将从数据库中移除该项目及其所有历史记录。
              磁盘上生成的文件不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                "删除"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
