import { useState, useCallback, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

import { GalleryPage } from "./components/Gallery";
import { SettingsPage } from "./components/Settings";
import { ProjectSelector, WelcomeScreen } from "./components/Project";
import { Sidebar, OptionsPanel } from "./components/Layout";

import { useProjects, useGenerationTasks, useGallery } from "./hooks";
import type { AssetType, AssetTypeCounts } from "./types";

type ViewMode = "history-images" | "history-videos" | "history-all";

function App() {
  // Project state
  const {
    projects,
    currentProject,
    loading: projectsLoading,
    createProject,
    deleteProject,
    selectProject,
  } = useProjects();

  // Gallery - for thumbnail regeneration, tagging, and counts
  const { regenerateThumbnails, addImageTag, removeImageTag, getAssetTypeCounts } = useGallery();

  // Asset type counts for categories
  const [assetTypeCounts, setAssetTypeCounts] = useState<AssetTypeCounts>({
    character: 0,
    background: 0,
    style: 0,
    prop: 0,
  });

  // Selected asset type for filtering
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | null>(null);

  // Regenerate thumbnails for old images on startup (runs once)
  const thumbnailsRegeneratedRef = useRef(false);
  useEffect(() => {
    if (!thumbnailsRegeneratedRef.current) {
      thumbnailsRegeneratedRef.current = true;
      regenerateThumbnails().then((count) => {
        if (count > 0) {
          console.log(`Regenerated ${count} thumbnails for faster loading`);
        }
      });
    }
  }, [regenerateThumbnails]);

  // Load asset type counts when project changes
  const loadCounts = useCallback(async () => {
    if (currentProject) {
      const counts = await getAssetTypeCounts(currentProject.id);
      setAssetTypeCounts(counts);
    }
  }, [currentProject, getAssetTypeCounts]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Refresh trigger for History
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const refreshResolverRef = useRef<(() => void) | null>(null);

  // Callback when a task completes - refresh gallery and return promise
  const handleTaskComplete = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      refreshResolverRef.current = resolve;
      setHistoryRefreshKey((prev) => prev + 1);
    });
  }, []);

  // Called when gallery finishes refreshing
  const handleRefreshComplete = useCallback(() => {
    if (refreshResolverRef.current) {
      refreshResolverRef.current();
      refreshResolverRef.current = null;
    }
    // Also refresh counts in case new images were added
    loadCounts();
  }, [loadCounts]);

  // Generation tasks state
  const {
    tasks,
    startImageTask,
    retryTask,
    dismissTask,
  } = useGenerationTasks({ onTaskComplete: handleTaskComplete });

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("history-all");
  const [showSettings, setShowSettings] = useState(false);

  // Handle view mode change from sidebar
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  // Handle asset type selection for filtering
  const handleAssetTypeSelect = useCallback((type: AssetType | null) => {
    setSelectedAssetType(type);
  }, []);

  // Handle dropping an image onto a category to tag it
  const handleDropImageToCategory = useCallback(async (imageId: string, assetType: AssetType) => {
    try {
      await addImageTag(imageId, assetType);
      toast.success(`已标记为${({ character: "角色", background: "背景", style: "风格", prop: "道具" }[assetType])}`);
      // Refresh gallery and counts
      setHistoryRefreshKey((prev) => prev + 1);
    } catch (e) {
      toast.error(`标记失败: ${e}`);
    }
  }, [addImageTag]);

  // Handle removing a tag from an image
  const handleRemoveImageTag = useCallback(async (imageId: string, assetType: AssetType) => {
    try {
      await removeImageTag(imageId, assetType);
      toast.success(`标签已移除`);
      // Refresh gallery and counts
      setHistoryRefreshKey((prev) => prev + 1);
    } catch (e) {
      toast.error(`移除标签失败: ${e}`);
    }
  }, [removeImageTag]);

  // If no projects exist or loading, show welcome screen
  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="h-screen bg-background">
        <WelcomeScreen
          onCreateProject={createProject}
          onSelectProject={selectProject}
        />
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // If no project selected, show welcome screen
  if (!currentProject) {
    return (
      <div className="h-screen bg-background">
        <WelcomeScreen
          onCreateProject={createProject}
          onSelectProject={selectProject}
        />
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // Settings page (modal/overlay approach)
  if (showSettings) {
    return (
      <div className="h-screen bg-background">
        <SettingsPage onBack={() => setShowSettings(false)} />
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b">
        <ProjectSelector
          projects={projects}
          currentProject={currentProject}
          onSelectProject={selectProject}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            AI 艺术工作站
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          assetTypeCounts={assetTypeCounts}
          viewMode={viewMode}
          selectedAssetType={selectedAssetType}
          onViewModeChange={handleViewModeChange}
          onAssetTypeSelect={handleAssetTypeSelect}
          onDropImageToCategory={handleDropImageToCategory}
        />

        {/* Main Workspace */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* History view - shows all project images/videos */}
          <div className="flex-1 min-h-0">
            <GalleryPage
              projectId={currentProject.id}
              filter={
                viewMode === "history-images"
                  ? "images"
                  : viewMode === "history-videos"
                  ? "videos"
                  : "all"
              }
              tasks={tasks}
              onRetryTask={retryTask}
              onDismissTask={dismissTask}
              refreshTrigger={historyRefreshKey}
              onRefreshComplete={handleRefreshComplete}
              selectedAssetType={selectedAssetType}
              onRemoveTag={handleRemoveImageTag}
            />
          </div>

          {/* Options Panel - always visible at bottom */}
          <div className="flex-shrink-0">
            <OptionsPanel
              projectId={currentProject.id}
              onStartImageTask={startImageTask}
            />
          </div>
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}

export default App;
