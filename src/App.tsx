import { useState, useCallback, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

import { GalleryPage } from "./components/Gallery";
import { SettingsPage } from "./components/Settings";
import { ProjectSelector, WelcomeScreen } from "./components/Project";
import { Sidebar, OptionsPanel } from "./components/Layout";

import { useProjects, useAssets, useGenerationTasks } from "./hooks";
import type { Asset } from "./types";

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

  // Assets state
  const { assetsByType, loadAssets } = useAssets(currentProject?.id || null);

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
  }, []);

  // Generation tasks state
  const {
    tasks,
    startImageTask,
    retryTask,
    dismissTask,
    hasRunningTasks,
  } = useGenerationTasks({ onTaskComplete: handleTaskComplete });

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("history-all");
  const [showSettings, setShowSettings] = useState(false);

  // Load assets when project changes
  useEffect(() => {
    if (currentProject) {
      loadAssets();
    }
  }, [currentProject, loadAssets]);

  // Handle asset click - preview or add to references
  const handleAssetClick = useCallback((asset: Asset) => {
    // TODO: Show asset preview dialog
    console.log("Asset clicked:", asset);
  }, []);

  // Handle asset drag start
  const handleAssetDragStart = useCallback((asset: Asset, e: React.DragEvent) => {
    e.dataTransfer.setData("application/json", JSON.stringify({
      type: "asset",
      id: asset.id,
      name: asset.name,
      file_path: asset.file_path,
      thumbnail: asset.thumbnail,
    }));
  }, []);

  // Handle import asset
  const handleImportAsset = useCallback(() => {
    // TODO: Open file dialog and create asset
    toast.info("Import asset - coming soon");
  }, []);

  // Handle view mode change from sidebar
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

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
            AI Art Station
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
          assetsByType={assetsByType}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onAssetClick={handleAssetClick}
          onAssetDragStart={handleAssetDragStart}
          onImportAsset={handleImportAsset}
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
            />
          </div>

          {/* Options Panel - always visible at bottom */}
          <div className="flex-shrink-0">
            <OptionsPanel
              projectId={currentProject.id}
              onStartImageTask={startImageTask}
              hasRunningTasks={hasRunningTasks}
            />
          </div>
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}

export default App;
